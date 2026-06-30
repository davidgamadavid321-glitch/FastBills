import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = (Deno.env.get('CRON_SERVICE_ROLE_KEY') ?? '')
  .replace(/^Bearer\s+/i, '')
  .trim()
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TIME_ZONE = 'America/Sao_Paulo'
const MANUAL_COOLDOWN_SECONDS = 60
const EXECUCAO_EXPIRADA_MINUTOS = 15
const PRAZO_ALERTA_PADRAO = 3
const PRAZO_ALERTA_MAXIMO = 30

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type TipoAviso = 'manha' | 'tarde'
type OrigemAviso = 'cron' | 'manual'
type ChatTelegram = {
  chat_id: number | string
}

type DadosAutorizacao = {
  userId: string | null
}

type ResultadoWorkspace = {
  workspaceId: string
  duplicado: boolean
  envios: number
  lancamentos: number
  status: string
}

class ErroRequisicao extends Error {
  status: number

  constructor(message: string, status = 400, name = 'ErroRequisicao') {
    super(message)
    this.name = name
    this.status = status
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function resumirErroSeguro(error: unknown) {
  if (!error || typeof error !== 'object') {
    return {
      codigo: 'ERRO_INTERNO',
      detalhes: 'Falha interna sem detalhes adicionais.',
    }
  }

  const erro = error as Record<string, unknown>
  const codigo = typeof erro.code === 'string' && erro.code
    ? erro.code
    : 'ERRO_INTERNO'
  const detalhes = codigo === 'PGRST201'
    ? 'Relacionamento ambiguo em uma consulta PostgREST.'
    : codigo.startsWith('PGRST')
    ? 'Falha em uma consulta PostgREST.'
    : codigo !== 'ERRO_INTERNO'
    ? 'Falha em uma operacao de dados.'
    : 'Falha interna ao consultar ou processar os avisos.'

  return { codigo, detalhes }
}

function extrairBearer(req: Request) {
  const authorization = req.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

async function autorizar(req: Request, origem: OrigemAviso): Promise<DadosAutorizacao> {
  const token = extrairBearer(req)
  const isServiceRole = !!token && token === SERVICE_ROLE_KEY

  if (origem === 'cron') {
    if (!isServiceRole) {
      throw new ErroRequisicao('Chamada automatica nao autorizada.', 401)
    }
    return { userId: null }
  }

  if (!token || isServiceRole) {
    throw new ErroRequisicao('Login necessario para enviar avisos manualmente.', 401)
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    throw new ErroRequisicao('Login necessario para enviar avisos manualmente.', 401)
  }

  return { userId: data.user.id }
}

function validarBody(body: unknown): { tipo: TipoAviso; origem: OrigemAviso } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErroRequisicao('Corpo da requisicao invalido.')
  }

  const payload = body as Record<string, unknown>
  const chavesPermitidas = new Set(['tipo', 'origem'])
  const chavesInvalidas = Object.keys(payload).filter((chave) => !chavesPermitidas.has(chave))
  if (chavesInvalidas.length > 0) {
    throw new ErroRequisicao('Parametros nao permitidos na requisicao.')
  }

  if (payload.tipo !== 'manha' && payload.tipo !== 'tarde') {
    throw new ErroRequisicao('Tipo de aviso invalido.')
  }

  if (payload.origem !== 'manual' && payload.origem !== 'cron') {
    throw new ErroRequisicao('Origem de aviso invalida.')
  }

  return { tipo: payload.tipo, origem: payload.origem }
}

function dataSaoPaulo(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(data)

  const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]))
  return `${mapa.year}-${mapa.month}-${mapa.day}`
}

function somarDias(dataISO: string, dias: number) {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias, 12, 0, 0))
  return dataSaoPaulo(data)
}

function formatarData(vencimento: string) {
  const [, mes, dia] = vencimento.split('-')
  return `${dia}/${mes}`
}

function parseChats(valor?: string | null): ChatTelegram[] {
  try {
    const chats = JSON.parse(valor || '[]')
    if (!Array.isArray(chats)) return []
    return chats.filter((chat) => (
      chat
      && typeof chat === 'object'
      && (typeof chat.chat_id === 'string' || typeof chat.chat_id === 'number')
    ))
  } catch {
    return []
  }
}

function linhaLancamento(lancamento: any, emoji: string, sufixo: string) {
  const conta = lancamento.contas?.nome ?? '-'
  const imovel = lancamento.contas?.centros_custo?.nome ?? 'Geral / Sem imovel'
  const titular = lancamento.contas?.titulares?.nome ?? 'Sem titular'
  const valor = `R$ ${Number(lancamento.valor ?? 0).toFixed(2).replace('.', ',')}`
  return `${emoji} ${conta} | ${imovel} | ${titular} | ${valor} | ${sufixo}`
}

async function obterWorkspaceUnicoDoUsuario(userId: string) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)

  if (error) throw error
  if (!data || data.length === 0) {
    throw new ErroRequisicao('Usuario sem workspace configurado.', 403)
  }
  if (data.length > 1) {
    throw new ErroRequisicao(
      'Usuario possui mais de um workspace. O seletor sera implementado em uma etapa futura.',
      409,
    )
  }

  return data[0].workspace_id as string
}

async function listarWorkspacesParaCron() {
  const { data, error } = await supabase
    .from('configuracoes')
    .select('workspace_id')
    .eq('chave', 'telegram_chats')

  if (error) throw error
  return Array.from(new Set((data ?? []).map((config) => config.workspace_id as string)))
}

async function carregarConfiguracoesWorkspace(workspaceId: string) {
  const { data, error } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .eq('workspace_id', workspaceId)
    .in('chave', ['telegram_chats', 'prazo_alerta_dias'])

  if (error) throw error

  const configuracoes = Object.fromEntries((data ?? []).map((config) => [config.chave, config.valor]))
  const prazoInformado = Number.parseInt(configuracoes.prazo_alerta_dias ?? '', 10)
  const prazo = Number.isFinite(prazoInformado)
    ? Math.max(1, Math.min(PRAZO_ALERTA_MAXIMO, prazoInformado))
    : PRAZO_ALERTA_PADRAO

  return {
    chats: parseChats(configuracoes.telegram_chats),
    prazo,
  }
}

async function buscarLancamentosWorkspace(
  workspaceId: string,
  tipo: TipoAviso,
  hoje: string,
  prazo: number,
) {
  const limite = tipo === 'manha' ? somarDias(hoje, prazo) : hoje
  const { data, error } = await supabase
    .from('lancamentos')
    .select(`
      *,
      contas:contas!lancamentos_workspace_conta_fkey(
        nome,
        centros_custo:centros_custo!contas_workspace_centro_fkey(nome),
        titulares:titulares!contas_workspace_titular_fkey(nome)
      )
    `)
    .eq('workspace_id', workspaceId)
    .neq('status', 'pago')
    .lte('vencimento', limite)
    .order('vencimento')

  if (error) throw error
  return data ?? []
}

function montarMensagem(tipo: TipoAviso, lancamentos: any[], hoje: string) {
  const vencidos = lancamentos.filter((lancamento) => lancamento.vencimento < hoje)
  const vencem = lancamentos.filter((lancamento) => lancamento.vencimento === hoje)
  const proximos = tipo === 'manha'
    ? lancamentos.filter((lancamento) => lancamento.vencimento > hoje)
    : []

  if (tipo === 'tarde' && vencidos.length === 0 && vencem.length === 0) return null
  if (tipo === 'manha' && lancamentos.length === 0) {
    return '✅ <b>Gestor de Contas</b> — Nenhuma conta pendente hoje.'
  }

  const linhas = tipo === 'manha'
    ? ['🔔 <b>Gestor de Contas — Avisos do dia</b>', '']
    : ['🌆 <b>Gestor de Contas — Lembrete da tarde</b>', '']

  if (vencidos.length > 0) {
    linhas.push('🔴 <b>Contas vencidas:</b>')
    vencidos.forEach((lancamento) => {
      linhas.push(linhaLancamento(
        lancamento,
        '🔴',
        `Venceu ${formatarData(lancamento.vencimento)}`,
      ))
    })
    linhas.push('')
  }

  if (vencem.length > 0) {
    linhas.push(tipo === 'manha' ? '🟡 <b>Vencem hoje:</b>' : '🟡 <b>Pague antes de amanhã:</b>')
    vencem.forEach((lancamento) => {
      linhas.push(linhaLancamento(
        lancamento,
        '🟡',
        `Hoje ${formatarData(lancamento.vencimento)}`,
      ))
    })
    linhas.push('')
  }

  if (proximos.length > 0) {
    linhas.push('🟢 <b>Vencem em breve:</b>')
    proximos.forEach((lancamento) => {
      linhas.push(linhaLancamento(
        lancamento,
        '🟢',
        `Dia ${formatarData(lancamento.vencimento)}`,
      ))
    })
  }

  return linhas.join('\n').trim()
}

async function liberarExecucaoExpirada(
  workspaceId: string,
  tipo: TipoAviso,
  origem: OrigemAviso,
  dataReferencia: string,
) {
  const limite = new Date(Date.now() - EXECUCAO_EXPIRADA_MINUTOS * 60 * 1000).toISOString()
  let query = supabase
    .from('telegram_aviso_execucoes')
    .update({
      status: 'erro',
      erro: 'Execucao expirada antes da conclusao.',
      finalizado_em: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('origem', origem)
    .eq('status', 'iniciado')
    .lt('criado_em', limite)

  if (origem === 'cron') {
    query = query
      .eq('tipo', tipo)
      .eq('data_referencia', dataReferencia)
  }

  const { error } = await query
  if (error) throw error
}

async function verificarCooldownManual(workspaceId: string) {
  const desde = new Date(Date.now() - MANUAL_COOLDOWN_SECONDS * 1000).toISOString()
  const { data, error } = await supabase
    .from('telegram_aviso_execucoes')
    .select('criado_em')
    .eq('workspace_id', workspaceId)
    .eq('origem', 'manual')
    .in('status', ['iniciado', 'enviado', 'sem_destinatarios', 'sem_lancamentos'])
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false })
    .limit(1)

  if (error) throw error
  if (!data || data.length === 0) return

  const criadoEm = new Date(data[0].criado_em).getTime()
  const aguarde = Math.max(
    1,
    MANUAL_COOLDOWN_SECONDS - Math.floor((Date.now() - criadoEm) / 1000),
  )
  throw new ErroRequisicao(
    `Aguarde ${aguarde}s para enviar avisos novamente.`,
    200,
    'CooldownManual',
  )
}

async function registrarExecucao(
  workspaceId: string,
  tipo: TipoAviso,
  origem: OrigemAviso,
  dataReferencia: string,
) {
  const { data, error } = await supabase
    .from('telegram_aviso_execucoes')
    .insert({
      workspace_id: workspaceId,
      tipo,
      origem,
      data_referencia: dataReferencia,
      status: 'iniciado',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { duplicado: true, id: null }
    throw error
  }

  return { duplicado: false, id: data.id as string }
}

async function atualizarExecucao(
  id: string | null,
  workspaceId: string,
  status: string,
  extras: Record<string, unknown> = {},
) {
  if (!id) return

  const { error } = await supabase
    .from('telegram_aviso_execucoes')
    .update({
      status,
      finalizado_em: new Date().toISOString(),
      ...extras,
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) throw error
}

async function enviarTelegram(chatId: number | string, mensagem: string) {
  const resposta = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: mensagem,
      parse_mode: 'HTML',
    }),
  })

  if (!resposta.ok) {
    throw new Error(`Falha ao enviar mensagem pelo Telegram (${resposta.status}).`)
  }
}

async function processarWorkspace(
  workspaceId: string,
  tipo: TipoAviso,
  origem: OrigemAviso,
  hoje: string,
): Promise<ResultadoWorkspace> {
  let execucaoId: string | null = null

  try {
    await liberarExecucaoExpirada(workspaceId, tipo, origem, hoje)
    if (origem === 'manual') {
      await verificarCooldownManual(workspaceId)
    }

    const registro = await registrarExecucao(workspaceId, tipo, origem, hoje)
    if (registro.duplicado) {
      return {
        workspaceId,
        duplicado: true,
        envios: 0,
        lancamentos: 0,
        status: 'duplicado',
      }
    }
    execucaoId = registro.id

    const { chats, prazo } = await carregarConfiguracoesWorkspace(workspaceId)
    if (chats.length === 0) {
      await atualizarExecucao(execucaoId, workspaceId, 'sem_destinatarios', {
        total_chats: 0,
        total_envios: 0,
        total_lancamentos: 0,
      })
      return {
        workspaceId,
        duplicado: false,
        envios: 0,
        lancamentos: 0,
        status: 'sem_destinatarios',
      }
    }

    const lancamentos = await buscarLancamentosWorkspace(workspaceId, tipo, hoje, prazo)
    const mensagem = montarMensagem(tipo, lancamentos, hoje)
    if (!mensagem) {
      await atualizarExecucao(execucaoId, workspaceId, 'sem_lancamentos', {
        total_chats: chats.length,
        total_envios: 0,
        total_lancamentos: lancamentos.length,
      })
      return {
        workspaceId,
        duplicado: false,
        envios: 0,
        lancamentos: lancamentos.length,
        status: 'sem_lancamentos',
      }
    }

    let envios = 0
    for (const chat of chats) {
      await enviarTelegram(chat.chat_id, mensagem)
      envios += 1
    }

    await atualizarExecucao(execucaoId, workspaceId, 'enviado', {
      total_chats: chats.length,
      total_envios: envios,
      total_lancamentos: lancamentos.length,
    })

    return {
      workspaceId,
      duplicado: false,
      envios,
      lancamentos: lancamentos.length,
      status: 'enviado',
    }
  } catch (error) {
    if (execucaoId) {
      await atualizarExecucao(execucaoId, workspaceId, 'erro', {
        erro: 'Falha ao processar avisos deste workspace.',
      }).catch(() => undefined)
    }
    throw error
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, erro: 'Metodo nao permitido.' }, 405)

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuracao server-side indisponivel.')
    }
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error('Configuracao do Telegram indisponivel.')
    }

    const body = await req.json().catch(() => null)
    const { tipo, origem } = validarBody(body)
    const autorizacao = await autorizar(req, origem)
    const hoje = dataSaoPaulo()

    if (origem === 'manual') {
      const workspaceId = await obterWorkspaceUnicoDoUsuario(autorizacao.userId as string)
      const resultado = await processarWorkspace(workspaceId, tipo, origem, hoje)

      if (resultado.duplicado) {
        return json({
          ok: false,
          duplicado: true,
          mensagem: 'Ja existe um envio manual em andamento.',
          envios: 0,
        }, 200)
      }

      const mensagem = resultado.status === 'sem_destinatarios'
        ? 'Nenhum chat cadastrado.'
        : resultado.status === 'sem_lancamentos'
        ? 'Nenhum lancamento para aviso.'
        : 'Avisos enviados com sucesso.'

      return json({
        ok: true,
        tipo,
        origem,
        envios: resultado.envios,
        lancamentos: resultado.lancamentos,
        mensagem,
      })
    }

    const workspaceIds = await listarWorkspacesParaCron()
    const resultados: ResultadoWorkspace[] = []
    let falhas = 0

    for (const workspaceId of workspaceIds) {
      try {
        resultados.push(await processarWorkspace(workspaceId, tipo, origem, hoje))
      } catch {
        falhas += 1
      }
    }

    return json({
      ok: true,
      tipo,
      origem,
      workspaces: workspaceIds.length,
      processados: resultados.length,
      ignorados: resultados.filter((resultado) => resultado.duplicado).length,
      falhas,
      envios: resultados.reduce((total, resultado) => total + resultado.envios, 0),
    })
  } catch (error) {
    if (error instanceof ErroRequisicao) {
      return json({ ok: false, erro: error.message }, error.status)
    }

    const erroSeguro = resumirErroSeguro(error)
    return json({
      ok: false,
      erro: 'Erro ao processar avisos.',
      codigo: erroSeguro.codigo,
      detalhes: erroSeguro.detalhes,
    }, 500)
  }
})
