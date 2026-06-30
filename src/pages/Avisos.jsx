import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Bell, Clock, FileText, Loader2, Plus, Minus, X, User, Tag, Send, ExternalLink,
  Droplets, Zap, Flame, Wifi, Shield, Home, CreditCard,
  Building2, Car, Smartphone, Package,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { enviarAvisosVencimento } from '../lib/telegram'
import { useWorkspace } from '../contexts/WorkspaceContext'

// ── Constantes ────────────────────────────────────────────────

const CORES = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#EF4444', '#F97316', '#06B6D4']

const ICONE_MAP = {
  Droplets, Zap, Flame, Wifi, Shield, Home, CreditCard, Building2, Car, Smartphone, Package,
}
const ICONE_KEYS = Object.keys(ICONE_MAP)
const LIMITE_ITENS_PREVIA = 15


// ── Helpers ───────────────────────────────────────────────────

function localISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function somarDiasISO(dataISO, dias) {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return localISODate(new Date(ano, mes - 1, dia + dias))
}

function formatarValor(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor ?? 0)
}

function formatarData(vencimento = '') {
  const [ano, mes, dia] = vencimento.split('-')
  return `${dia}/${mes}/${ano}`
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
  const { data: atualizado } = await supabase
    .from('configuracoes')
    .update({ valor, atualizado_em: atualizadoEm })
    .eq('chave', chave)
    .eq('workspace_id', workspaceId)
    .select('chave')
    .maybeSingle()

  if (atualizado) {
    return
  }

  await supabase
    .from('configuracoes')
    .insert({ chave, valor, workspace_id: workspaceId, atualizado_em: atualizadoEm })
}

// ── Seção Cabeçalho ───────────────────────────────────────────

function SecaoHeader({ icon: Icon, titulo, descricao }) {
  return (
    <div className="flex items-start gap-3 pb-3 border-b border-slate-100">
      <Icon size={16} className="text-slate-500 shrink-0 mt-0.5" />
      <div>
        <h2 className="text-sm font-bold text-slate-900">{titulo}</h2>
        {descricao && <p className="text-xs text-slate-500 mt-0.5">{descricao}</p>}
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

  async function handleAdicionar() {
    if (!nome.trim()) return
    setSalvando(true)
    const { data, error } = await supabase
      .from('titulares')
      .insert({ nome: nome.trim(), cor, workspace_id: workspaceId })
      .select()
      .single()
    setSalvando(false)
    if (error) return
    setTitulares(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNome('')
    setCor(CORES[0])
    setAdicionando(false)
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
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
              className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
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
                className="p-1 rounded-lg hover:bg-slate-200 transition-colors shrink-0"
              >
                <X size={14} className="text-slate-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {erroRemover && <p className="text-xs text-red-500">{erroRemover}</p>}

      {adicionando ? (
        <div className="space-y-2.5 border border-slate-200 rounded-xl p-3">
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
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
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
              className="relative rounded-2xl border border-slate-200 p-3 flex flex-col items-center gap-1.5 bg-white"
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
            className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors min-h-[80px]"
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

  useEffect(() => {
    function buscarChats() {
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
      setFeedbackEnvio({ ok: false, mensagem: e.message ?? 'Erro ao enviar avisos.' })
    }
    setEnviando(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <SecaoHeader
        icon={Bell}
        titulo="Notificações Telegram"
        descricao="Avisos de vencimento enviados via bot do Telegram"
      />

      {/* Link de ativação */}
      <div className="bg-slate-50 rounded-xl p-3 space-y-1">
        <a
          href="https://t.me/gestaosmart_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors"
        >
          <ExternalLink size={14} />
          Clique aqui para ativar os avisos
        </a>
        <p className="text-xs text-slate-500">
          Abra o link, clique em Iniciar e comece a receber os avisos.
        </p>
      </div>

      {/* Lista de usuários cadastrados */}
      {loadingChats ? (
        <div className="flex justify-center py-2">
          <Loader2 size={16} className="animate-spin text-slate-300" />
        </div>
      ) : chats.length > 0 ? (
        <div className="space-y-2">
          {chats.map(c => (
            <div
              key={c.chat_id}
              className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{c.nome}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{c.chat_id}</p>
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
        <p className="text-xs text-slate-400">Nenhum usuario cadastrado ainda.</p>
      )}

      {/* Botão enviar */}
      <div className="pt-1 border-t border-slate-100 space-y-1.5">
        <button
          onClick={handleEnviarAgora}
          disabled={enviando}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors disabled:opacity-50"
        >
          {enviando
            ? <Loader2 size={14} className="animate-spin" />
            : <Send size={14} />}
          {enviando ? 'Enviando...' : 'Enviar aviso agora'}
        </button>
        {feedbackEnvio && (
          <p className={`text-xs ${feedbackEnvio.ok ? 'text-green-600' : 'text-red-500'}`}>
            {feedbackEnvio.mensagem}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Seção: Prazo de alerta ────────────────────────────────────

function SecaoPrazo({ prazo, onChange }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <SecaoHeader
        icon={Bell}
        titulo="Prazo de alerta"
        descricao="Quantos dias antes do vencimento avisar"
      />

      <div className="flex items-center gap-4">
        <button
          onClick={() => onChange(prazo - 1)}
          disabled={prazo <= 1}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus size={15} className="text-slate-600" />
        </button>

        <div className="text-center min-w-[56px]">
          <p className="text-3xl font-black text-slate-900 leading-none tabular-nums">{prazo}</p>
          <p className="text-xs text-slate-400 mt-1">{prazo === 1 ? 'dia' : 'dias'}</p>
        </div>

        <button
          onClick={() => onChange(prazo + 1)}
          disabled={prazo >= 30}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Plus size={15} className="text-slate-600" />
        </button>
      </div>
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
    <div className="py-2 border-t border-slate-100 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-slate-900 truncate">{nome}</p>
        <p className="shrink-0 text-sm font-black text-slate-900">{formatarValor(lancamento.valor)}</p>
      </div>
      <p className="text-xs text-slate-600 mt-1">{descricao}</p>
      <div className="mt-1.5 space-y-0.5">
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
        <h3 className="text-sm font-black text-slate-900">{titulo}</h3>
        <div className="rounded-xl bg-white border border-slate-100 p-3">
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
      titulo: '🔴 Vencidas',
      lancamentos: vencidas,
      criarDescricao: l => `Venceu em ${formatarData(l.vencimento)}`,
    })
    adicionarGrupo({
      titulo: '🟡 Vencem hoje',
      lancamentos: hojeLista,
      criarDescricao: () => 'Vence hoje',
    })
    adicionarGrupo({
      titulo: '🟢 Próximas',
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <SecaoHeader
        icon={Send}
        titulo="Prévia do aviso"
        descricao="Aproximação visual da mensagem enviada pelo Telegram"
      />

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={16} className="animate-spin text-slate-300" />
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2">
          <p className="text-sm font-black text-slate-900">✅ Tudo certo por aqui!</p>
          <p className="text-sm text-slate-600">Nenhuma conta pendente encontrada para este aviso.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-4">
          <div>
            <p className="text-sm font-black text-slate-900">
              🔔 Bom dia! Aqui está seu resumo de contas
            </p>
            <p className="text-sm text-slate-600 mt-2">
              Você tem {total} conta(s) para acompanhar:
            </p>
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

  const [titulares,         setTitulares]          = useState([])
  const [categorias,        setCategorias]         = useState([])

  const [historico,         setHistorico]          = useState([])
  const [loadingHistorico,  setLoadingHistorico]   = useState(true)

  const [contasAFazer,      setContasAFazer]       = useState([])
  const [loadingContas,     setLoadingContas]      = useState(true)
  const [lancamentosPrevia, setLancamentosPrevia]  = useState([])
  const [loadingPrevia,     setLoadingPrevia]      = useState(true)

  const prazoTimerRef = useRef(null)

  useEffect(() => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    // Configurações
    supabase
      .from('configuracoes')
      .select('chave, valor')
      .eq('chave', 'prazo_alerta_dias')
      .eq('workspace_id', workspaceId)
      .then(({ data }) => {
        const cfg = Object.fromEntries((data ?? []).map(r => [r.chave, r.valor]))

        if (cfg.prazo_alerta_dias) {
          const v = parseInt(cfg.prazo_alerta_dias, 10)
          if (!isNaN(v)) setPrazo(Math.max(1, Math.min(30, v)))
        }
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

  function handlePrazoChange(novo) {
    const clamped = Math.max(1, Math.min(30, novo))
    setPrazo(clamped)
    if (prazoTimerRef.current) clearTimeout(prazoTimerRef.current)
    prazoTimerRef.current = setTimeout(
      () => upsertConfig('prazo_alerta_dias', String(clamped), workspaceId),
      500
    )
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">

      {/* ── Coluna esquerda: titulares + configurações ── */}
      <div className="space-y-4">
        <SecaoTitulares titulares={titulares} setTitulares={setTitulares} />
        <SecaoTelegram />
        <SecaoPrazo prazo={prazo} onChange={handlePrazoChange} />
        <SecaoPreviaAviso lancamentos={lancamentosPrevia} loading={loadingPrevia} />
      </div>

      {/* ── Coluna direita: categorias + histórico + contas a fazer ── */}
      <div className="space-y-4">

        <SecaoCategorias categorias={categorias} setCategorias={setCategorias} />

        {/* Histórico de alterações */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <SecaoHeader icon={Clock} titulo="Histórico de alterações" />

          {loadingHistorico ? (
            <div className="flex justify-center py-6">
              <Loader2 size={16} className="animate-spin text-slate-300" />
            </div>
          ) : historico.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              Nenhuma alteração registrada.
            </p>
          ) : (
            <div className="space-y-4">
              {historico.map(l => {
                const inicial    = (l.alterado_por ?? '?')[0].toUpperCase()
                const nomeConta  = l.contas?.nome ?? '—'
                const nomeImovel = l.contas?.centros_custo?.nome
                const statusTxt  = STATUS_LABEL[l.status] ?? l.status

                return (
                  <div key={l.id} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
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
                      <p className="text-[11px] text-slate-400 mt-0.5">
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
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
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
            <p className="text-sm text-slate-400 text-center py-4">
              Nenhum contrato pendente.
            </p>
          ) : (
            <div className="space-y-2">
              {contasAFazer.map(conta => {
                const t = titularAtual(conta)
                return (
                  <div
                    key={conta.id}
                    className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 py-2.5"
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
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
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
  )
}
