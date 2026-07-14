import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

const headers = {
  'Content-Type': 'application/json',
}

const MENSAGEM_START_SEM_CODIGO = [
  '✅ Bot do GestaoSmart iniciado.',
  '',
  'Para conectar ao sistema, abra Avisos > Telegram e gere um código de conexão.',
].join('\n')

const MENSAGEM_CODIGO_INVALIDO = 'Código inválido ou expirado. Gere um novo código em Avisos > Telegram.'
const MENSAGEM_CONECTADO = '✅ Telegram conectado com sucesso ao seu espaço GestaoSmart.'
const MENSAGEM_PADRAO = 'Para conectar o Telegram, gere um código em Avisos > Telegram e envie /start CODIGO.'

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

function resumirErroSeguro(error: unknown): string {
  if (error instanceof Error && error.message) return 'Falha ao processar a requisicao.'
  return 'Falha interna sem detalhes adicionais.'
}

function extrairCodigoStart(texto: string) {
  const match = texto.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i)
  if (!match) {
    return { ehStart: false, codigo: '' }
  }

  const codigo = (match[1] ?? '').trim().split(/\s+/)[0] ?? ''
  return { ehStart: true, codigo }
}

async function responderTelegram(chatId: number | string, texto: string) {
  const resposta = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: 'HTML',
    }),
  })

  if (!resposta.ok) {
    throw new Error(`Falha ao enviar mensagem pelo Telegram (${resposta.status}).`)
  }
}

function obterServiceRoleKey() {
  return (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim()
}

function criarSupabaseServiceRole(serviceRoleKey: string) {
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, erro: 'Metodo nao permitido.' }, 405)
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, erro: 'Configuracao indisponivel.' }, 500)
  }

  const secretRecebido = req.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (secretRecebido !== TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, erro: 'Nao autorizado.' }, 401)
  }

  const update = await req.json().catch(() => null) as {
    message?: { chat?: { id?: number | string }; text?: string }
  } | null

  const chatId = update?.message?.chat?.id
  if (!chatId) {
    return json({ ok: true, ignored: true })
  }

  const texto = typeof update?.message?.text === 'string' ? update.message.text.trim() : ''
  const { ehStart, codigo } = extrairCodigoStart(texto)

  let mensagem = MENSAGEM_PADRAO

  if (ehStart && !codigo) {
    mensagem = MENSAGEM_START_SEM_CODIGO
  } else if (ehStart && codigo) {
    const serviceRoleKey = obterServiceRoleKey()

    if (!SUPABASE_URL || !serviceRoleKey) {
      mensagem = MENSAGEM_CODIGO_INVALIDO
    } else {
      try {
        const supabase = criarSupabaseServiceRole(serviceRoleKey)
        const { data, error } = await supabase.rpc('conectar_telegram_por_codigo', {
          p_code: codigo,
          p_chat_id: String(chatId),
        })

        if (error) throw error

        mensagem = data?.ok === true
          ? MENSAGEM_CONECTADO
          : MENSAGEM_CODIGO_INVALIDO
      } catch (error) {
        console.error('Erro ao conectar Telegram por codigo:', resumirErroSeguro(error))
        mensagem = MENSAGEM_CODIGO_INVALIDO
      }
    }
  }

  try {
    await responderTelegram(chatId, mensagem)
  } catch (error) {
    console.error('Erro ao responder no webhook do Telegram:', resumirErroSeguro(error))
  }

  return json({ ok: true })
})
