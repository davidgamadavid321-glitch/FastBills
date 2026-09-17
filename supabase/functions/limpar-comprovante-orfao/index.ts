// Remove com seguranca um comprovante orfao: o PDF foi enviado ao Storage,
// mas o UPDATE em lancamentos.pdf_url falhou logo em seguida (ex.: rede,
// RLS, timeout). A policy de DELETE do bucket 'comprovantes' e' admin-only
// (matriz de papeis do BUG-12), entao um member nao consegue limpar o
// proprio upload que falhou. Esta funcao roda com service_role e faz essa
// limpeza de forma controlada, sem afrouxar a policy de Storage:
//
//   - exige um JWT valido de usuario autenticado (verify_jwt default = true);
//   - exige que o usuario pertenca ao workspace informado;
//   - exige que o caminho pertenca exatamente ao workspace + lancamento
//     informados (regex, sem coringa livre);
//   - RECUSA remover se o caminho for o pdf_url atualmente salvo no
//     lancamento -- so' remove arquivo comprovadamente orfao, nunca um
//     comprovante ativo. Isso nao e' um endpoint de exclusao geral.
//   - RECUSA remover se o objeto no Storage nao pertencer ao proprio usuario
//     que esta chamando (storage.objects.owner). Sem essa checagem, um
//     member mal-intencionado do mesmo workspace poderia tentar "correr"
//     contra o upload legitimo de outro membro (upload ja concluido, UPDATE
//     do lancamento ainda em voo) e apagar o arquivo de outra pessoa antes
//     do UPDATE confirmar o pdf_url. Exigir owner = auth.uid() do chamador
//     fecha essa janela: so' quem realmente enviou aquele arquivo pode
//     limpa-lo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// workspace_id / centro (ou "sem-centro") / AAAA-MM / lancamento_id.pdf
const CAMINHO_REGEX = /^([0-9a-fA-F-]{36})\/[^/]+\/\d{4}-\d{2}\/([0-9a-fA-F-]{36})\.pdf$/

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function resumirErroSeguro(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Falha interna sem detalhes adicionais.'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, erro: 'Metodo nao permitido.' }, 405)
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ ok: false, erro: 'Configuracao indisponivel.' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) {
    return json({ ok: false, erro: 'Nao autenticado.' }, 401)
  }

  const corpo = await req.json().catch(() => null) as {
    workspace_id?: string
    lancamento_id?: string
    caminho?: string
  } | null

  const workspaceId = corpo?.workspace_id
  const lancamentoId = corpo?.lancamento_id
  const caminho = corpo?.caminho

  if (!workspaceId || !lancamentoId || !caminho) {
    return json({ ok: false, erro: 'Parametros obrigatorios ausentes.' }, 400)
  }

  const match = caminho.match(CAMINHO_REGEX)
  if (!match || match[1].toLowerCase() !== workspaceId.toLowerCase() || match[2].toLowerCase() !== lancamentoId.toLowerCase()) {
    return json({ ok: false, erro: 'Caminho de comprovante invalido para este lancamento.' }, 400)
  }

  try {
    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: erroUser } = await supabaseAuth.auth.getUser()
    if (erroUser || !userData?.user) {
      return json({ ok: false, erro: 'Sessao invalida ou expirada.' }, 401)
    }

    const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: membership, error: erroMembership } = await supabaseService
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userData.user.id)
      .maybeSingle()

    if (erroMembership) throw erroMembership
    if (!membership) {
      return json({ ok: false, erro: 'Usuario nao pertence a este workspace.' }, 403)
    }

    const { data: lancamento, error: erroLancamento } = await supabaseService
      .from('lancamentos')
      .select('id, pdf_url')
      .eq('id', lancamentoId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (erroLancamento) throw erroLancamento
    if (!lancamento) {
      return json({ ok: false, erro: 'Lancamento nao encontrado neste workspace.' }, 404)
    }

    if (lancamento.pdf_url === caminho) {
      return json({
        ok: false,
        erro: 'Este arquivo e\' o comprovante ativo deste lancamento e nao pode ser removido por esta rota.',
      }, 409)
    }

    // Confere quem realmente enviou o objeto. Fecha a janela de corrida em
    // que um member tentaria apagar o upload de outro membro que ainda esta'
    // em voo (arquivo ja gravado no bucket, UPDATE do lancamento ainda nao
    // confirmado).
    // Seleciona owner (uuid, legado) e owner_id (text, versoes mais novas do
    // Storage) -- projetos Supabase diferem em qual coluna esta' populada.
    const { data: objeto, error: erroObjeto } = await supabaseService
      .schema('storage')
      .from('objects')
      .select('owner, owner_id')
      .eq('bucket_id', 'comprovantes')
      .eq('name', caminho)
      .maybeSingle()

    if (erroObjeto) throw erroObjeto
    if (!objeto) {
      // Arquivo ja nao existe mais no bucket (ex.: outra tentativa de limpeza
      // ja resolveu). Nao ha' nada para remover -- responde sucesso idempotente.
      return json({ ok: true, ja_removido: true })
    }

    const donoConfere = objeto.owner === userData.user.id
      || objeto.owner_id === userData.user.id
    if (!donoConfere) {
      return json({ ok: false, erro: 'Este arquivo nao foi enviado por este usuario.' }, 403)
    }

    const { error: erroRemove } = await supabaseService.storage
      .from('comprovantes')
      .remove([caminho])

    if (erroRemove) throw erroRemove

    return json({ ok: true })
  } catch (error) {
    console.error('Erro ao limpar comprovante orfao:', resumirErroSeguro(error))
    return json({ ok: false, erro: 'Falha ao remover arquivo orfao.' }, 500)
  }
})
