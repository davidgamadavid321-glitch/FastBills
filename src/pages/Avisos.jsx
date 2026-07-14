import { useState, useEffect, useMemo } from 'react'
import {
  Bell, Clock, FileText, Loader2, Plus, X, User, Tag, Send, ExternalLink,
  Droplets, Zap, Flame, Wifi, Shield, Home, CreditCard,
  Building2, Car, Smartphone, Package,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { enviarAvisosVencimento, MENSAGEM_ERRO_ENVIO_TELEGRAM } from '../lib/telegram'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { formatarMoeda as formatarValor, localISODate } from '../lib/utils'

// ── Constantes ────────────────────────────────────────────────

const CORES = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#EF4444', '#F97316', '#06B6D4']

const ICONE_MAP = {
  Droplets, Zap, Flame, Wifi, Shield, Home, CreditCard, Building2, Car, Smartphone, Package,
}
const ICONE_KEYS = Object.keys(ICONE_MAP)
const LIMITE_ITENS_PREVIA = 15
const ALERTAS_TIMEZONE = 'America/Sao_Paulo'
const HORARIOS_PADRAO = {
  '1': ['08:00'],
  '2': ['08:00', '18:00'],
  '3': ['08:00', '14:00', '20:00'],
}


// ── Helpers ───────────────────────────────────────────────────

function somarDiasISO(dataISO, dias) {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return localISODate(new Date(ano, mes - 1, dia + dias))
}

function formatarData(vencimento = '') {
  const [ano, mes, dia] = vencimento.split('-')
  return `${dia}/${mes}/${ano}`
}

function normalizarPrazo(valor, fallback = 3) {
  const numero = Number.parseInt(String(valor ?? ''), 10)
  return Number.isFinite(numero)
    ? Math.max(1, Math.min(30, numero))
    : fallback
}

function normalizarHorarios(horarios) {
  if (!Array.isArray(horarios)) return []

  return Array.from(new Set(
    horarios
      .filter(horario => typeof horario === 'string')
      .map(horario => horario.trim())
      .filter(horario => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(horario)),
  )).sort()
}

function inferirFrequencia(horarios) {
  const normalizados = normalizarHorarios(horarios)
  const entrada = normalizados.join('|')

  for (const [frequencia, padrao] of Object.entries(HORARIOS_PADRAO)) {
    if (entrada === padrao.join('|')) return frequencia
  }

  return 'personalizado'
}

function criarConfigAlertasPadrao(prazo = 3) {
  return {
    ativo: true,
    prazo_alerta_dias: normalizarPrazo(prazo),
    horarios: HORARIOS_PADRAO['2'],
    timezone: ALERTAS_TIMEZONE,
    versao: 1,
  }
}

function parseConfigAlertas(valor, prazoLegado = 3) {
  const fallback = criarConfigAlertasPadrao(prazoLegado)

  if (!valor) return fallback

  try {
    const config = JSON.parse(valor)
    if (!config || typeof config !== 'object' || Array.isArray(config)) return fallback

    return {
      ativo: config.ativo === true,
      prazo_alerta_dias: normalizarPrazo(config.prazo_alerta_dias, fallback.prazo_alerta_dias),
      horarios: normalizarHorarios(config.horarios),
      timezone: ALERTAS_TIMEZONE,
      versao: 1,
    }
  } catch {
    return fallback
  }
}

function titularAtual(conta) {
  const ativo = conta.contas_titulares?.find(ct => ct.fim === null)
  return ativo?.titulares ?? conta.titulares ?? null
}

function formatarAlteradoEm(isoString) {
  const data  = new Date(isoString)
  const hoje  = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(ontem.getDate() - 1)

  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  if (data.toLocaleDateString('pt-BR') === hoje.toLocaleDateString('pt-BR'))
    return `Hoje às ${hora}`
  if (data.toLocaleDateString('pt-BR') === ontem.toLocaleDateString('pt-BR'))
    return `Ontem às ${hora}`

  return `${data.toLocaleDateString('pt-BR')} às ${hora}`
}

const STATUS_LABEL = {
  pago:     'pago',
  vencido:  'vencido',
  pendente: 'pendente',
}

async function upsertConfig(chave, valor, workspaceId) {
  const atualizadoEm = new Date().toISOString()
  const { data: atualizado, error: erroUpdate } = await supabase
    .from('configuracoes')
    .update({ valor, atualizado_em: atualizadoEm })
    .eq('chave', chave)
    .eq('workspace_id', workspaceId)
    .select('chave')
    .maybeSingle()

  if (erroUpdate) throw erroUpdate

  if (atualizado) {
    return
  }

  const { error: erroInsert } = await supabase
    .from('configuracoes')
    .insert({ chave, valor, workspace_id: workspaceId, atualizado_em: atualizadoEm })

  if (erroInsert) throw erroInsert
}

// ── Seção Cabeçalho ───────────────────────────────────────────

function SecaoHeader({ icon: Icon, titulo, descricao }) {
  return (
    <div className="flex items-start gap-3 pb-4 border-b border-slate-100">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
        <Icon size={15} className="text-slate-600" />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-950">{titulo}</h2>
        {descricao && <p className="text-xs leading-relaxed text-slate-500 mt-0.5">{descricao}</p>}
      </div>
    </div>
  )
}

// ── Seção: Titulares ──────────────────────────────────────────

function SecaoTitulares({ titulares, setTitulares }) {
  const { workspaceId } = useWorkspace()
  const [adicionando, setAdicionando] = useState(false)
  const [nome,        setNome]        = useState('')
  const [cor,         setCor]         = useState(CORES[0])
  const [salvando,    setSalvando]    = useState(false)
  const [erroRemover, setErroRemover] = useState('')
  const [erroAdicionar, setErroAdicionar] = useState('')

  async function handleAdicionar() {
    const nomeAparado = nome.trim()

    if (!nomeAparado) {
      setErroAdicionar('Informe o nome do titular.')
      return
    }
    if (!workspaceId) {
      setErroAdicionar('Não foi possível identificar o espaço de trabalho. Recarregue a página e tente novamente.')
      return
    }

    setSalvando(true)
    setErroAdicionar('')

    const payload = {
      nome: nomeAparado,
      cor: cor || CORES[0],
      workspace_id: workspaceId,
    }

    if (import.meta.env.DEV) {
      console.log('Payload titular:', {
        nome: payload.nome,
        cor: payload.cor,
        workspace_id: payload.workspace_id,
      })
    }

    try {
      const { data, error } = await supabase
        .from('titulares')
        .insert(payload)
        .select()
        .single()

      if (error) throw error

      setTitulares(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
      setNome('')
      setCor(CORES[0])
      setAdicionando(false)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Erro ao criar titular:', {
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
          workspaceId,
        })
      }
      setErroAdicionar('Não foi possível criar o titular. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function handleRemover(id) {
    setErroRemover('')
    const { count } = await supabase
      .from('contas')
      .select('id', { count: 'exact', head: true })
      .eq('titular_id', id)
      .eq('workspace_id', workspaceId)
    if ((count ?? 0) > 0) {
      setErroRemover('Este titular possui contas vinculadas e não pode ser removido.')
      return
    }
    await supabase.from('titulares').delete().eq('id', id).eq('workspace_id', workspaceId)
    setTitulares(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
      <SecaoHeader
        icon={User}
        titulo="Titulares"
        descricao="Responsáveis pelas contas"
      />

      {titulares.length > 0 && (
        <div className="space-y-2">
          {titulares.map(t => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-sm"
                  style={{ backgroundColor: t.cor ?? '#64748b' }}
                >
                  {(t.nome ?? '?')[0].toUpperCase()}
                </span>
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: t.cor ?? '#334155' }}
                >
                  {t.nome}
                </p>
              </div>
              <button
                onClick={() => handleRemover(t.id)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors shrink-0"
              >
                <X size={14} className="text-slate-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {erroRemover && <p className="text-xs text-red-500">{erroRemover}</p>}

      {adicionando ? (
        <div className="space-y-2.5 border border-slate-200 rounded-xl p-3 bg-slate-50/50">
          <input
            type="text"
            value={nome}
            onChange={e => setNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdicionar()}
            placeholder="Nome do titular"
            autoFocus
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
          />
          <div className="flex gap-1.5 flex-wrap">
            {CORES.map(c => (
              <button
                key={c}
                onClick={() => setCor(c)}
                className="w-6 h-6 rounded-full shrink-0 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  outline: cor === c ? `2px solid ${c}` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
          {erroAdicionar && <p className="text-xs text-red-500">{erroAdicionar}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { setAdicionando(false); setNome(''); setErroAdicionar('') }}
              disabled={salvando}
              className="flex-1 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleAdicionar}
              disabled={!nome.trim() || salvando}
              className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {salvando && <Loader2 size={14} className="animate-spin" />}
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setAdicionando(true); setErroRemover(''); setErroAdicionar('') }}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <Plus size={14} />
          Adicionar titular
        </button>
      )}
    </div>
  )
}

// ── Seção: Categorias ─────────────────────────────────────────

function SecaoCategorias({ categorias, setCategorias }) {
  const { workspaceId } = useWorkspace()
  const [adicionando, setAdicionando] = useState(false)
  const [nome,        setNome]        = useState('')
  const [icone,       setIcone]       = useState(ICONE_KEYS[0])
  const [salvando,    setSalvando]    = useState(false)
  const [erroRemover, setErroRemover] = useState('')

  async function handleAdicionar() {
    if (!nome.trim()) return
    setSalvando(true)
    const { data, error } = await supabase
      .from('categorias')
      .insert({ nome: nome.trim(), icone, workspace_id: workspaceId })
      .select()
      .single()
    setSalvando(false)
    if (error) return
    setCategorias(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNome('')
    setIcone(ICONE_KEYS[0])
    setAdicionando(false)
  }

  async function handleRemover(id) {
    setErroRemover('')
    const { count } = await supabase
      .from('contas')
      .select('id', { count: 'exact', head: true })
      .eq('categoria_id', id)
      .eq('workspace_id', workspaceId)
    if ((count ?? 0) > 0) {
      setErroRemover('Esta categoria possui contas vinculadas e não pode ser removida.')
      return
    }
    await supabase.from('categorias').delete().eq('id', id).eq('workspace_id', workspaceId)
    setCategorias(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
      <SecaoHeader
        icon={Tag}
        titulo="Categorias"
        descricao="Tipos de contas e despesas"
      />

      <div className="grid grid-cols-3 gap-2">
        {categorias.map(cat => {
          const Ic = ICONE_MAP[cat.icone] ?? Tag
          return (
            <div
              key={cat.id}
              className="relative rounded-xl border border-slate-200 p-3 flex flex-col items-center gap-1.5 bg-white shadow-sm shadow-slate-200/30"
            >
              <Ic size={18} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-700 text-center leading-tight line-clamp-2">
                {cat.nome}
              </span>
              <button
                onClick={() => handleRemover(cat.id)}
                className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-slate-100 transition-colors"
              >
                <X size={11} className="text-slate-300 hover:text-slate-500 transition-colors" />
              </button>
            </div>
          )
        })}

        {adicionando ? (
          <div className="col-span-3 border border-slate-200 rounded-xl p-3 space-y-2.5">
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdicionar()}
              placeholder="Nome da categoria"
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
            />
            <div className="grid grid-cols-6 gap-1.5">
              {ICONE_KEYS.map(key => {
                const Ic = ICONE_MAP[key]
                return (
                  <button
                    key={key}
                    onClick={() => setIcone(key)}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                      icone === key
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    <Ic size={14} />
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setAdicionando(false); setNome('') }}
                disabled={salvando}
                className="flex-1 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdicionar}
                disabled={!nome.trim() || salvando}
                className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {salvando && <Loader2 size={14} className="animate-spin" />}
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setAdicionando(true); setErroRemover('') }}
            className="rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors min-h-[80px]"
          >
            <Plus size={16} />
            <span className="text-[11px] font-bold">Nova</span>
          </button>
        )}
      </div>

      {erroRemover && <p className="text-xs text-red-500 mt-1">{erroRemover}</p>}
    </div>
  )
}

// ── Seção: Notificações Telegram ─────────────────────────────

function SecaoTelegram() {
  const { workspaceId } = useWorkspace()
  const [chats,         setChats]        = useState([])
  const [loadingChats,  setLoadingChats] = useState(true)
  const [removendo,     setRemovendo]    = useState(null)
  const [enviando,      setEnviando]     = useState(false)
  const [feedbackEnvio, setFeedbackEnvio] = useState(null)
  const [gerandoCodigo, setGerandoCodigo] = useState(false)
  const [codigoConexao, setCodigoConexao] = useState(null)
  const [erroCodigo,    setErroCodigo]    = useState('')

  const chatsValidos = useMemo(
    () => chats.filter(chat => chat && (typeof chat.chat_id === 'string' || typeof chat.chat_id === 'number')),
    [chats],
  )
  const telegramConectado = chatsValidos.length > 0
  const comandoConexao = codigoConexao?.code ? `/start ${codigoConexao.code}` : ''
  const linkBot = codigoConexao?.code
    ? `https://t.me/gestaosmart_bot?start=${encodeURIComponent(codigoConexao.code)}`
    : 'https://t.me/gestaosmart_bot'
  const expiracaoCodigo = codigoConexao?.expires_at
    ? new Date(codigoConexao.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : ''

  useEffect(() => {
    function buscarChats() {
      if (!workspaceId) {
        setChats([])
        setLoadingChats(false)
        return
      }

      supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', 'telegram_chats')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
        .then(({ data }) => {
          try { setChats(JSON.parse(data?.valor || '[]')) } catch { setChats([]) }
          setLoadingChats(false)
        })
    }

    buscarChats()
    const intervalo = setInterval(buscarChats, 10000)
    return () => clearInterval(intervalo)
  }, [workspaceId])

  async function handleGerarCodigo() {
    if (!workspaceId) {
      setErroCodigo('Não foi possível identificar o espaço de trabalho. Recarregue a página e tente novamente.')
      return
    }

    setGerandoCodigo(true)
    setErroCodigo('')

    try {
      const { data, error } = await supabase.rpc('gerar_codigo_conexao_telegram', {
        p_workspace_id: workspaceId,
      })

      if (error) throw error

      const resultado = Array.isArray(data) ? data[0] : data
      if (!resultado?.code || !resultado?.expires_at) {
        throw new Error('Resposta invalida ao gerar codigo de conexao.')
      }

      setCodigoConexao(resultado)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Erro ao gerar codigo de conexao do Telegram:', error)
      }
      setErroCodigo('Não foi possível gerar o código. Tente novamente.')
    } finally {
      setGerandoCodigo(false)
    }
  }

  async function handleRemover(chatId) {
    setRemovendo(chatId)
    const nova = chats.filter(c => c.chat_id !== chatId)
    await upsertConfig('telegram_chats', JSON.stringify(nova), workspaceId)
    setChats(nova)
    setRemovendo(null)
  }

  async function handleEnviarAgora() {
    setEnviando(true)
    setFeedbackEnvio(null)
    try {
      const resultado = await enviarAvisosVencimento(supabase, 'manha')
      const total = resultado?.envios ?? 0
      setFeedbackEnvio({
        ok: true,
        mensagem: resultado?.mensagem || (total === 0
          ? 'Nenhum chat cadastrado para receber avisos.'
          : 'Avisos enviados com sucesso.'),
      })
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('Erro ao enviar avisos pelo Telegram:', e)
      }
      setFeedbackEnvio({ ok: false, mensagem: MENSAGEM_ERRO_ENVIO_TELEGRAM })
    }
    setEnviando(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
      <SecaoHeader
        icon={Bell}
        titulo="Canal Telegram"
        descricao="Conexão segura para envio dos avisos de vencimento"
      />

      <div className={`rounded-xl border p-4 space-y-3 ${
        telegramConectado
          ? 'border-emerald-200 bg-emerald-50/50'
          : 'border-slate-200 bg-slate-50'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-950">
                {telegramConectado ? 'Telegram conectado' : 'Telegram pendente'}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                telegramConectado
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {telegramConectado ? 'Ativo' : 'Sem chat'}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              {telegramConectado
                ? 'Este espaço já possui chat autorizado para receber avisos.'
                : 'Gere um código temporário e envie no bot para autorizar este espaço.'}
            </p>
          </div>
          <span className={`mt-1 shrink-0 w-2.5 h-2.5 rounded-full ${telegramConectado ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        </div>

        <button
          onClick={handleGerarCodigo}
          disabled={gerandoCodigo || !workspaceId}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          {gerandoCodigo ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {gerandoCodigo ? 'Gerando...' : 'Gerar código de conexão'}
        </button>

        {erroCodigo && <p className="text-xs text-red-500">{erroCodigo}</p>}

        {codigoConexao && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3 shadow-sm shadow-slate-200/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Código</p>
                <p className="text-lg font-black text-slate-950 tracking-normal font-mono tabular-nums">{codigoConexao.code}</p>
              </div>
              {expiracaoCodigo && (
                <p className="text-xs text-slate-500 shrink-0 tabular-nums">Expira às {expiracaoCodigo}</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Envie no bot</p>
              <p className="text-sm font-mono font-semibold text-slate-900 break-all">{comandoConexao}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <a
                href={linkBot}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors"
              >
                <ExternalLink size={14} />
                Abrir bot com código
              </a>
              <p className="text-xs leading-relaxed text-slate-500">
                Se o link não preencher o código, envie manualmente no bot: <span className="font-mono font-semibold text-slate-700">{comandoConexao}</span>
              </p>
            </div>
          </div>
        )}

        {!codigoConexao && (
          <a
            href="https://t.me/gestaosmart_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors"
          >
            <ExternalLink size={14} />
            Abrir bot no Telegram
          </a>
        )}
      </div>

      {loadingChats ? (
        <div className="flex justify-center py-2">
          <Loader2 size={16} className="animate-spin text-slate-300" />
        </div>
      ) : chatsValidos.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Chats autorizados
          </p>
          {chatsValidos.map(c => (
            <div
              key={c.chat_id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{c.nome}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5 tabular-nums">{c.chat_id}</p>
              </div>
              <button
                onClick={() => handleRemover(c.chat_id)}
                disabled={removendo === c.chat_id}
                className="p-1 rounded-lg hover:bg-slate-200 transition-colors shrink-0 disabled:opacity-50"
              >
                {removendo === c.chat_id
                  ? <Loader2 size={14} className="animate-spin text-slate-400" />
                  : <X size={14} className="text-slate-400" />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          Nenhum chat autorizado ainda.
        </p>
      )}

      <div className="pt-4 border-t border-slate-100 space-y-2">
        <button
          onClick={handleEnviarAgora}
          disabled={enviando}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {enviando
            ? <Loader2 size={14} className="animate-spin" />
            : <Send size={14} />}
          {enviando ? 'Enviando...' : 'Enviar aviso agora'}
        </button>
        {feedbackEnvio && (
          <p className={`rounded-lg px-3 py-2 text-xs ${feedbackEnvio.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {feedbackEnvio.mensagem}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Seção: Configuração dos alertas ───────────────────────────

function SecaoConfiguracaoAlertas({
  config,
  setConfig,
  frequencia,
  setFrequencia,
  onSalvar,
  salvando,
  feedback,
  erro,
}) {
  function atualizarConfig(campo, valor) {
    setConfig(prev => ({ ...prev, [campo]: valor }))
  }

  function handleFrequenciaChange(novaFrequencia) {
    setFrequencia(novaFrequencia)
    if (novaFrequencia !== 'personalizado') {
      atualizarConfig('horarios', HORARIOS_PADRAO[novaFrequencia])
    }
  }

  function atualizarHorario(indice, valor) {
    setConfig(prev => ({
      ...prev,
      horarios: prev.horarios.map((horario, i) => (i === indice ? valor : horario)),
    }))
  }

  function adicionarHorario() {
    setFrequencia('personalizado')
    setConfig(prev => ({ ...prev, horarios: [...prev.horarios, '08:00'] }))
  }

  function removerHorario(indice) {
    setFrequencia('personalizado')
    setConfig(prev => ({
      ...prev,
      horarios: prev.horarios.filter((_, i) => i !== indice),
    }))
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
      <SecaoHeader
        icon={Clock}
        titulo="Configuração dos alertas"
        descricao="Defina quando este workspace recebe avisos automáticos"
      />

      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 space-y-4">
        <label className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-950">Alertas Telegram ativados</p>
            <p className="text-xs leading-relaxed text-slate-500 mt-0.5">
              Quando ativo, o scheduler usa os horários salvos abaixo.
            </p>
          </div>
          <input
            type="checkbox"
            checked={config.ativo}
            onChange={e => atualizarConfig('ativo', e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
        </label>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600">
            Avisar contas que vencem em até X dias
          </label>
          <input
            type="number"
            min="1"
            max="30"
            value={config.prazo_alerta_dias}
            onChange={e => atualizarConfig('prazo_alerta_dias', e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">Frequência</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['1', '1 vez ao dia'],
              ['2', '2 vezes ao dia'],
              ['3', '3 vezes ao dia'],
              ['personalizado', 'Personalizado'],
            ].map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => handleFrequenciaChange(valor)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  frequencia === valor
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-600">Horários</p>
            {frequencia === 'personalizado' && (
              <button
                type="button"
                onClick={adicionarHorario}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Plus size={12} />
                Adicionar
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {config.horarios.map((horario, indice) => (
              <div key={`${indice}-${horario}`} className="flex items-center gap-2">
                <input
                  type="time"
                  value={horario}
                  onChange={e => atualizarHorario(indice, e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                {frequencia === 'personalizado' && (
                  <button
                    type="button"
                    onClick={() => removerHorario(indice)}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-700 flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {config.horarios.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
              Nenhum horário configurado.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Horário local: {ALERTAS_TIMEZONE.replace('_', ' ')}.
          </p>
        </div>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{erro}</p>}
      {feedback && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{feedback}</p>}

      <button
        type="button"
        onClick={onSalvar}
        disabled={salvando}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
      >
        {salvando ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
        {salvando ? 'Salvando...' : 'Salvar configuração'}
      </button>
    </div>
  )
}

// ── Seção: Prévia do aviso ───────────────────────────────────

function LinhaPreviaLancamento({ lancamento, descricao }) {
  const conta = lancamento.contas
  const nome = conta?.nome ?? 'Conta sem nome'
  const imovel = conta?.centros_custo?.nome ?? 'Geral'
  const titular = conta?.titulares?.nome ?? 'Sem titular'

  return (
    <div className="py-3 border-t border-slate-100 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-slate-900 truncate">{nome}</p>
        <p className="shrink-0 text-sm font-black text-slate-950 tabular-nums">{formatarValor(lancamento.valor)}</p>
      </div>
      <p className="text-xs font-medium text-slate-600 mt-1">{descricao}</p>
      <div className="mt-1.5 grid grid-cols-1 gap-0.5 sm:grid-cols-2 sm:gap-2">
        <p className="text-xs text-slate-500 truncate">Imóvel: {imovel}</p>
        <p className="text-xs text-slate-500 truncate">Titular: {titular}</p>
      </div>
    </div>
  )
}

function montarGrupoPrevia({ titulo, lancamentos, criarDescricao, restante }) {
  if (lancamentos.length === 0 || restante <= 0) return { elemento: null, usados: 0 }

  const visiveis = lancamentos.slice(0, restante)
  return {
    usados: visiveis.length,
    elemento: (
      <div className="space-y-2" key={titulo}>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{titulo}</h3>
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm shadow-slate-200/30">
          {visiveis.map(lancamento => (
            <LinhaPreviaLancamento
              key={lancamento.id}
              lancamento={lancamento}
              descricao={criarDescricao(lancamento)}
            />
          ))}
        </div>
      </div>
    ),
  }
}

function SecaoPreviaAviso({ lancamentos, loading }) {
  const hoje = useMemo(() => localISODate(new Date()), [])

  const { grupos, total, ocultos } = useMemo(() => {
    const vencidas = lancamentos.filter(l => l.vencimento < hoje)
    const hojeLista = lancamentos.filter(l => l.vencimento === hoje)
    const proximas = lancamentos.filter(l => l.vencimento > hoje)

    let usados = 0
    const elementos = []

    function adicionarGrupo(config) {
      const secao = montarGrupoPrevia({
        ...config,
        restante: LIMITE_ITENS_PREVIA - usados,
      })
      if (secao.elemento) elementos.push(secao.elemento)
      usados += secao.usados
    }

    adicionarGrupo({
      titulo: 'Vencidas',
      lancamentos: vencidas,
      criarDescricao: l => `Venceu em ${formatarData(l.vencimento)}`,
    })
    adicionarGrupo({
      titulo: 'Vencem hoje',
      lancamentos: hojeLista,
      criarDescricao: () => 'Vence hoje',
    })
    adicionarGrupo({
      titulo: 'Próximas',
      lancamentos: proximas,
      criarDescricao: l => `Vence em ${formatarData(l.vencimento)}`,
    })

    return {
      grupos: elementos,
      total: lancamentos.length,
      ocultos: Math.max(0, lancamentos.length - usados),
    }
  }, [lancamentos, hoje])

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
      <SecaoHeader
        icon={Send}
        titulo="Prévia do aviso"
        descricao="Contas pendentes incluídas no próximo alerta"
      />

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={16} className="animate-spin text-slate-300" />
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-950">Nenhuma pendência no período</p>
          <p className="text-sm text-slate-600">Não há contas vencidas ou próximas dentro do prazo configurado.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                Resumo que será enviado
              </p>
              <p className="text-sm text-slate-600 mt-1">
                {total} conta(s) para acompanhar no Telegram.
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 tabular-nums border border-slate-200">
              {total}
            </span>
          </div>

          {grupos}

          {ocultos > 0 && (
            <p className="text-xs font-semibold text-slate-500">
              + {ocultos} conta(s) pendente(s) no sistema.
            </p>
          )}

          <p className="text-xs text-slate-500">
            Acesse o sistema para marcar pagamentos e anexar comprovantes.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────

export default function Avisos() {
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const [loadingCfg,        setLoadingCfg]        = useState(true)
  const [prazo,             setPrazo]              = useState(3)
  const [alertasConfig,     setAlertasConfig]      = useState(() => criarConfigAlertasPadrao(3))
  const [frequenciaAlertas, setFrequenciaAlertas]  = useState('2')
  const [salvandoAlertas,   setSalvandoAlertas]    = useState(false)
  const [feedbackAlertas,   setFeedbackAlertas]    = useState('')
  const [erroAlertas,       setErroAlertas]        = useState('')

  const [titulares,         setTitulares]          = useState([])
  const [categorias,        setCategorias]         = useState([])

  const [historico,         setHistorico]          = useState([])
  const [loadingHistorico,  setLoadingHistorico]   = useState(true)

  const [contasAFazer,      setContasAFazer]       = useState([])
  const [loadingContas,     setLoadingContas]      = useState(true)
  const [lancamentosPrevia, setLancamentosPrevia]  = useState([])
  const [loadingPrevia,     setLoadingPrevia]      = useState(true)

  useEffect(() => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    setLoadingCfg(true)

    // Configurações
    supabase
      .from('configuracoes')
      .select('chave, valor')
      .eq('workspace_id', workspaceId)
      .in('chave', ['prazo_alerta_dias', 'telegram_alertas_config'])
      .then(({ data, error }) => {
        if (error) {
          if (import.meta.env.DEV) {
            console.error('Erro ao carregar configuração de alertas:', {
              message: error?.message,
              code: error?.code,
              details: error?.details,
              hint: error?.hint,
              workspaceId,
            })
          }
          setErroAlertas('Não foi possível carregar a configuração de alertas.')
          setLoadingCfg(false)
          return
        }

        const cfg = Object.fromEntries((data ?? []).map(r => [r.chave, r.valor]))
        const prazoLegado = normalizarPrazo(cfg.prazo_alerta_dias)
        const configAlertas = parseConfigAlertas(cfg.telegram_alertas_config, prazoLegado)

        setPrazo(configAlertas.prazo_alerta_dias)
        setAlertasConfig(configAlertas)
        setFrequenciaAlertas(inferirFrequencia(configAlertas.horarios))
        setErroAlertas('')
        setFeedbackAlertas('')
        setLoadingCfg(false)
      })

    // Titulares
    supabase
      .from('titulares')
      .select('id, nome, cor')
      .eq('workspace_id', workspaceId)
      .order('nome')
      .then(({ data }) => setTitulares(data ?? []))

    // Categorias
    supabase
      .from('categorias')
      .select('id, nome, icone')
      .eq('workspace_id', workspaceId)
      .order('nome')
      .then(({ data }) => setCategorias(data ?? []))

    // Histórico de alterações
    supabase
      .from('lancamentos')
      .select(`
        id, alterado_por, alterado_em, status,
        contas:contas!lancamentos_workspace_conta_fkey(
          nome,
          centros_custo:centros_custo!contas_workspace_centro_fkey(nome)
        )
      `)
      .not('alterado_em', 'is', null)
      .eq('workspace_id', workspaceId)
      .order('alterado_em', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setHistorico(data ?? [])
        setLoadingHistorico(false)
      })

    // Contas a fazer
    supabase
      .from('contas')
      .select(`
        id, nome,
        centros_custo:centros_custo!contas_workspace_centro_fkey(nome),
        titulares:titulares!contas_workspace_titular_fkey(nome, cor),
        contas_titulares:contas_titulares!contas_titulares_workspace_conta_fkey(
          titular_id, fim,
          titulares:titulares!contas_titulares_workspace_titular_fkey(nome, cor)
        )
      `)
      .eq('status_contrato', 'a_fazer')
      .eq('workspace_id', workspaceId)
      .order('nome')
      .then(({ data }) => {
        setContasAFazer(data ?? [])
        setLoadingContas(false)
      })
  }, [workspaceId, loadingWorkspace, erroWorkspace])

  useEffect(() => {
    if (loadingWorkspace || erroWorkspace || loadingCfg || !workspaceId) return

    const hoje = localISODate(new Date())
    const limite = somarDiasISO(hoje, prazo)

    setLoadingPrevia(true)
    supabase
      .from('lancamentos')
      .select(`
        id, valor, vencimento, status,
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
      .then(({ data }) => {
        setLancamentosPrevia(data ?? [])
        setLoadingPrevia(false)
      })
  }, [workspaceId, loadingWorkspace, erroWorkspace, loadingCfg, prazo])

  async function handleSalvarAlertas() {
    if (!workspaceId) {
      setErroAlertas('Não foi possível identificar o espaço de trabalho. Recarregue a página e tente novamente.')
      return
    }

    setSalvandoAlertas(true)
    setErroAlertas('')
    setFeedbackAlertas('')

    try {
      const prazoNormalizado = normalizarPrazo(alertasConfig.prazo_alerta_dias)
      const horariosNormalizados = normalizarHorarios(alertasConfig.horarios)

      if (alertasConfig.ativo && horariosNormalizados.length === 0) {
        setErroAlertas('Informe pelo menos um horário para manter os alertas ativos.')
        return
      }

      const payload = {
        ativo: alertasConfig.ativo === true,
        prazo_alerta_dias: prazoNormalizado,
        horarios: horariosNormalizados,
        timezone: ALERTAS_TIMEZONE,
        versao: 1,
      }

      await upsertConfig('telegram_alertas_config', JSON.stringify(payload), workspaceId)
      await upsertConfig('prazo_alerta_dias', String(prazoNormalizado), workspaceId)

      setAlertasConfig(payload)
      setFrequenciaAlertas(inferirFrequencia(horariosNormalizados))
      setPrazo(prazoNormalizado)
      setFeedbackAlertas('Configuração salva com sucesso.')
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Erro ao salvar configuração de alertas Telegram:', {
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
          workspaceId,
        })
      }
      setErroAlertas('Não foi possível salvar a configuração. Tente novamente.')
    } finally {
      setSalvandoAlertas(false)
    }
  }

  if (erroWorkspace) {
    return <p className="text-sm text-red-500">{erroWorkspace}</p>
  }

  if (loadingWorkspace || loadingCfg) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 size={20} className="animate-spin text-slate-300" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Operação
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
            Avisos e cadastros
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            Configure alertas, conexão Telegram e listas auxiliares usadas no controle financeiro.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/40">
          <Bell size={13} />
          Alertas ativos
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">

        {/* ── Coluna esquerda: titulares + configurações ── */}
        <div className="space-y-4">
          <SecaoTitulares titulares={titulares} setTitulares={setTitulares} />
          <SecaoTelegram />
          <SecaoConfiguracaoAlertas
            config={alertasConfig}
            setConfig={setAlertasConfig}
            frequencia={frequenciaAlertas}
            setFrequencia={setFrequenciaAlertas}
            onSalvar={handleSalvarAlertas}
            salvando={salvandoAlertas}
            feedback={feedbackAlertas}
            erro={erroAlertas}
          />
          <SecaoPreviaAviso lancamentos={lancamentosPrevia} loading={loadingPrevia} />
        </div>

        {/* ── Coluna direita: categorias + histórico + contas a fazer ── */}
        <div className="space-y-4">

          <SecaoCategorias categorias={categorias} setCategorias={setCategorias} />

          {/* Histórico de alterações */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
            <SecaoHeader
              icon={Clock}
              titulo="Histórico de alterações"
              descricao="Últimas marcações feitas nos lançamentos"
            />

            {loadingHistorico ? (
              <div className="flex justify-center py-6">
                <Loader2 size={16} className="animate-spin text-slate-300" />
              </div>
            ) : historico.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Nenhuma alteração registrada.
              </p>
            ) : (
              <div className="space-y-3">
                {historico.map(l => {
                  const inicial    = (l.alterado_por ?? '?')[0].toUpperCase()
                  const nomeConta  = l.contas?.nome ?? '—'
                  const nomeImovel = l.contas?.centros_custo?.nome
                  const statusTxt  = STATUS_LABEL[l.status] ?? l.status

                  return (
                    <div key={l.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-white text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 border border-slate-200">
                        {inicial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-800 leading-relaxed">
                          Marcou{' '}
                          <span className="font-semibold">{nomeConta}</span>
                          {nomeImovel && (
                            <span className="text-slate-500"> ({nomeImovel})</span>
                          )}{' '}
                          como <span className="font-semibold">{statusTxt}</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {formatarAlteradoEm(l.alterado_em)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Contas a fazer */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/40">
            <SecaoHeader
              icon={FileText}
              titulo="Contas a fazer"
              descricao="Contratos pendentes de ativação"
            />

            {loadingContas ? (
              <div className="flex justify-center py-6">
                <Loader2 size={16} className="animate-spin text-slate-300" />
              </div>
            ) : contasAFazer.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Nenhum contrato pendente.
              </p>
            ) : (
              <div className="space-y-2">
                {contasAFazer.map(conta => {
                  const t = titularAtual(conta)
                  return (
                    <div
                      key={conta.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {conta.nome}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {conta.centros_custo?.nome && (
                            <p className="text-xs text-slate-500 truncate">
                              {conta.centros_custo.nome}
                            </p>
                          )}
                          {t && conta.centros_custo?.nome && (
                            <span className="text-slate-300 text-xs shrink-0">·</span>
                          )}
                          {t && (
                            <p
                              className="text-xs font-semibold truncate"
                              style={{ color: t.cor ?? '#64748b' }}
                            >
                              {t.nome}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 shrink-0">
                        A fazer
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
