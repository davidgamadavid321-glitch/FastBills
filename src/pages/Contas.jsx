import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Plus, MoreVertical, Loader2, Tag, Trash2, Search, Inbox, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { formatarMoeda as formatarValor, localISODate, normalizarDataISO } from '../lib/utils'
import ModalFormConta from '../components/ModalFormConta'

// ── Helpers ──────────────────────────────────────────────────

const RECORRENCIA_LABEL = {
  uma_vez: 'Uma vez',
  mensal:  'Mensal',
  anual:   'Anual',
}

const FILTRO_TODOS = 'todos'
const FILTRO_GERAL = 'geral'
const FILTRO_SEM_TITULAR = 'sem_titular'
const DIAS_PROXIMAS = 7
const LIMITE_CONTAS_POR_GRUPO = 4

const GRUPOS_VENCIMENTO = [
  {
    chave: 'vencidas',
    titulo: 'Vencidas',
    descricao: 'Contas com vencimento anterior a hoje',
    classe: 'border-red-100 bg-white',
    destaque: 'bg-red-500',
    contador: 'text-red-700 bg-red-50 border-red-100',
  },
  {
    chave: 'hoje',
    titulo: 'Vencem hoje',
    descricao: 'Prioridade do dia',
    classe: 'border-amber-100 bg-white',
    destaque: 'bg-amber-500',
    contador: 'text-amber-800 bg-amber-50 border-amber-100',
  },
  {
    chave: 'proximas',
    titulo: 'Próximas',
    descricao: `Vencem em até ${DIAS_PROXIMAS} dias`,
    classe: 'border-emerald-100 bg-white',
    destaque: 'bg-emerald-500',
    contador: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  },
  {
    chave: 'futuras',
    titulo: 'Futuras',
    descricao: 'Vencimentos depois desse período',
    classe: 'border-slate-200 bg-white',
    destaque: 'bg-slate-300',
    contador: 'text-slate-700 bg-slate-50 border-slate-200',
  },
  {
    chave: 'pagas',
    titulo: 'Pagas',
    descricao: 'Lançamentos pagos no filtro atual',
    classe: 'border-slate-200 bg-white',
    destaque: 'bg-slate-900',
    contador: 'text-slate-700 bg-slate-50 border-slate-200',
  },
]

// Retorna o titular atual: registro ativo em contas_titulares (fim IS NULL),
// com fallback para o titular_id direto da conta.
function titularAtual(conta) {
  const ativo = conta.contas_titulares?.find(ct => ct.fim === null)
  return ativo?.titulares ?? conta.titulares ?? null
}

function IconeLucide({ nome, ...props }) {
  const Icon = (nome && LucideIcons[nome]) ? LucideIcons[nome] : Tag
  return <Icon {...props} />
}

function registrarErroDesenvolvimento(contexto, error) {
  if (import.meta.env.DEV) console.error(contexto, error)
}

function normalizarBusca(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function somarDiasISO(dataISO, dias) {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return localISODate(new Date(ano, mes - 1, dia + dias))
}

function dataVencimentoReferencia(conta, hojeISO) {
  const dia = Number(conta.dia_vencimento)
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) return ''

  const [anoAtual, mesAtual] = hojeISO.split('-').map(Number)
  const mesReferencia = conta.recorrencia === 'anual' && conta.mes_vencimento
    ? Number(conta.mes_vencimento)
    : mesAtual

  if (!Number.isInteger(mesReferencia) || mesReferencia < 1 || mesReferencia > 12) return ''
  return localISODate(new Date(anoAtual, mesReferencia - 1, dia))
}

function chaveLancamento(contaId, vencimento) {
  const data = normalizarDataISO(vencimento)
  return contaId && data ? `${contaId}|${data}` : ''
}

function classificarVencimento(vencimento, hojeISO) {
  if (!vencimento) return 'futuras'

  if (vencimento < hojeISO) return 'vencidas'
  if (vencimento === hojeISO) return 'hoje'
  if (vencimento <= somarDiasISO(hojeISO, DIAS_PROXIMAS)) return 'proximas'
  return 'futuras'
}

function lancamentoRelevanteConta(conta, lancamentosPorConta) {
  const lancamentosConta = lancamentosPorConta.get(conta.id) ?? []
  const naoPagos = lancamentosConta
    .filter(lancamento => lancamento.status !== 'pago')
    .sort((a, b) => a.vencimentoISO.localeCompare(b.vencimentoISO))

  return naoPagos[0] ?? null
}

function grupoVencimentoConta(conta, hojeISO, lancamentosPorContaVencimento, lancamentosPorConta) {
  const lancamentoNaoPago = lancamentoRelevanteConta(conta, lancamentosPorConta)
  if (lancamentoNaoPago) {
    const vencimento = lancamentoNaoPago.vencimentoISO
    return { grupo: classificarVencimento(vencimento, hojeISO), vencimento }
  }

  const vencimento = dataVencimentoReferencia(conta, hojeISO)
  if (!vencimento) return { grupo: 'futuras', vencimento: '9999-12-31' }

  const lancamento = lancamentosPorContaVencimento.get(chaveLancamento(conta.id, vencimento))
  if (lancamento?.status === 'pago') return { grupo: 'pagas', vencimento }

  return { grupo: classificarVencimento(vencimento, hojeISO), vencimento }
}

function ordenarPorVencimento(a, b, hojeISO, lancamentosPorContaVencimento, lancamentosPorConta) {
  const vencimentoA = grupoVencimentoConta(a, hojeISO, lancamentosPorContaVencimento, lancamentosPorConta).vencimento
  const vencimentoB = grupoVencimentoConta(b, hojeISO, lancamentosPorContaVencimento, lancamentosPorConta).vencimento
  return (
    vencimentoA.localeCompare(vencimentoB)
    || (a.nome ?? '').localeCompare(b.nome ?? '')
  )
}

function dadosCentroConta(conta) {
  const vinculada = Boolean(conta.centro_id)
  return {
    badge: vinculada ? 'Imóvel' : 'Geral',
    nome: vinculada
      ? (conta.centros_custo?.nome ?? 'Imóvel não identificado')
      : 'Sem imóvel',
    badgeClass: vinculada
      ? 'bg-slate-900 text-white'
      : 'bg-slate-100 text-slate-600 border border-slate-200',
  }
}

// ── Sub-componentes ──────────────────────────────────────────

function MenuBtn({ label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 ${
        danger ? 'text-red-600' : 'text-slate-700'
      }`}
    >
      {label}
    </button>
  )
}

function CardConta({
  conta,
  modoSelecao,
  selecionada,
  onSelecionar,
  onEditar,
  onExcluir,
  onVerLancamentos,
}) {
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef(null)
  const isAtivo = conta.status_contrato === 'ativo'
  const titular = titularAtual(conta)
  const cor = titular?.cor
  const centro = dadosCentroConta(conta)

  useEffect(() => {
    if (!menuAberto) return
    function handler(e) {
      if (!menuRef.current?.contains(e.target)) setMenuAberto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuAberto])

  const vencimentoLabel = (() => {
    if (conta.__lancamentoPago?.vencimentoISO) {
      const [ano, mes, dia] = conta.__lancamentoPago.vencimentoISO.split('-')
      return `Pago em ${dia}/${mes}/${ano}`
    }

    if (!conta.dia_vencimento) return null
    if (conta.recorrencia === 'anual' && conta.mes_vencimento) {
      const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                     'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
      return `Dia ${conta.dia_vencimento} de ${meses[conta.mes_vencimento - 1]}`
    }
    return `Todo dia ${conta.dia_vencimento}`
  })()

  return (
    <div className={`bg-white rounded-xl border p-3 sm:p-5 flex flex-col gap-2.5 sm:gap-4 shadow-sm shadow-slate-200/60 transition-colors min-w-0 ${
      selecionada ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
    }`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-1.5 sm:gap-3">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0">
          {modoSelecao && (
            <input
              type="checkbox"
              checked={selecionada}
              onChange={() => onSelecionar(conta.id)}
              aria-label={`Selecionar ${conta.nome}`}
              className="mt-1 h-4 w-4 shrink-0 accent-slate-900 sm:mt-2.5"
            />
          )}
          <div
            className="hidden sm:flex w-10 h-10 rounded-xl items-center justify-center shrink-0 ring-1 ring-black/5"
            style={{ backgroundColor: cor ? `${cor}22` : '#f1f5f9' }}
          >
            <IconeLucide
              nome={conta.categorias?.icone}
              size={19}
              style={{ color: cor ?? '#64748b' }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-slate-950 leading-tight line-clamp-2 break-words sm:truncate">{conta.nome}</p>
            <div className="mt-1 hidden sm:flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {RECORRENCIA_LABEL[conta.recorrencia] ?? '—'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold" style={{ color: cor ?? '#64748b' }}>
                {titular?.nome ?? 'Sem titular'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-1 sm:items-center sm:gap-2 shrink-0">
          <span
            className={`hidden sm:inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
              isAtivo ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-800 border-amber-100'
            }`}
          >
            {isAtivo ? 'Ativo' : 'A fazer'}
          </span>
          {!modoSelecao && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuAberto(m => !m)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors sm:p-1.5"
              >
                <MoreVertical size={15} className="text-slate-400 sm:w-4 sm:h-4" />
              </button>
              {menuAberto && (
                <div className="absolute right-0 top-9 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-900/10 py-1.5 w-44 z-20">
                  <MenuBtn label="Editar" onClick={() => { onEditar(); setMenuAberto(false) }} />
                  <MenuBtn label="Ver lançamentos" onClick={() => { onVerLancamentos(); setMenuAberto(false) }} />
                  <div className="h-px bg-slate-100 my-1" />
                  <MenuBtn label="Excluir" onClick={() => { onExcluir(); setMenuAberto(false) }} danger />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detalhes */}
      <div className="sm:hidden space-y-1.5 pt-2 border-t border-slate-100">
        {conta.valor_referencia != null && (
          <p className="text-sm font-bold text-slate-950 tabular-nums truncate">{formatarValor(conta.valor_referencia)}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          {vencimentoLabel && (
            <p className="min-w-0 truncate text-[11px] font-semibold text-slate-600 tabular-nums">{vencimentoLabel}</p>
          )}
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              isAtivo ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-800 border-amber-100'
            }`}
          >
            {isAtivo ? 'Ativo' : 'A fazer'}
          </span>
        </div>
      </div>

      <div className="hidden sm:grid grid-cols-2 gap-x-4 gap-y-3 pt-4 border-t border-slate-100">
        <div className="min-w-0 col-span-2 sm:col-span-1">
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Imóvel</p>
          <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold leading-none ${centro.badgeClass}`}>
              {centro.badge}
            </span>
            <span className="min-w-0 truncate text-xs text-slate-700 font-semibold">
              {centro.nome}
            </span>
          </div>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Categoria</p>
          <p className="text-xs text-slate-700 font-semibold mt-1.5 truncate">{conta.categorias?.nome ?? 'Sem categoria'}</p>
        </div>
        {vencimentoLabel && (
          <div>
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Vencimento</p>
            <p className="text-xs text-slate-700 font-semibold mt-1.5 tabular-nums">{vencimentoLabel}</p>
          </div>
        )}
        {conta.valor_referencia != null && (
          <div className="text-left sm:text-right">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Valor referência</p>
            <p className="text-sm text-slate-950 font-bold mt-1 tabular-nums">{formatarValor(conta.valor_referencia)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SecaoGrupoContas({
  grupo,
  contas,
  expandido,
  onToggleExpandido,
  modoSelecao,
  contasSelecionadas,
  onSelecionar,
  onEditar,
  onExcluir,
  onVerLancamentos,
}) {
  if (contas.length === 0) return null

  const deveLimitar = contas.length > LIMITE_CONTAS_POR_GRUPO
  const contasVisiveis = expandido ? contas : contas.slice(0, LIMITE_CONTAS_POR_GRUPO)
  const quantidadeRestante = contas.length - LIMITE_CONTAS_POR_GRUPO

  return (
    <section className={`rounded-2xl border p-3 sm:p-4 space-y-3 shadow-sm shadow-slate-200/60 ${grupo.classe}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          <span className={`mt-1 h-8 w-1 rounded-full ${grupo.destaque}`} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">{grupo.titulo}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{grupo.descricao}</p>
          </div>
        </div>
        <span className={`shrink-0 text-[11px] font-bold border rounded-full px-2.5 py-1 tabular-nums ${grupo.contador}`}>
          {contas.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 xl:grid-cols-2 sm:gap-4">
        {contasVisiveis.map(conta => (
          <CardConta
            key={conta.__itemKey ?? conta.id}
            conta={conta}
            modoSelecao={modoSelecao}
            selecionada={contasSelecionadas.has(conta.id)}
            onSelecionar={onSelecionar}
            onEditar={() => onEditar(conta)}
            onExcluir={() => onExcluir(conta)}
            onVerLancamentos={() => onVerLancamentos(conta)}
          />
        ))}
      </div>

      {deveLimitar && (
        <button
          type="button"
          onClick={onToggleExpandido}
          className="mx-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/50 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          {expandido ? (
            <>
              Mostrar menos
              <ChevronUp size={14} />
            </>
          ) : (
            <>
              Mostrar mais {quantidadeRestante} {quantidadeRestante === 1 ? 'conta' : 'contas'}
              <ChevronDown size={14} />
            </>
          )}
        </button>
      )}
    </section>
  )
}

// ── Página principal ─────────────────────────────────────────

export default function Contas() {
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()

  const [contas, setContas]             = useState([])
  const [titulares, setTitulares]       = useState([])
  const [centrosCusto, setCentrosCusto] = useState([])
  const [categorias, setCategorias]     = useState([])
  const [lancamentos, setLancamentos]   = useState([])
  const [loading, setLoading]           = useState(true)

  // Filtros — pré-preenche centro se vindo de Imóveis
  const [busca,             setBusca]             = useState('')
  const [filtroTitular,     setFiltroTitular]     = useState(FILTRO_TODOS)
  const [filtroCentro,      setFiltroCentro]      = useState(location.state?.centroId ?? FILTRO_TODOS)
  const [filtroCategoria,   setFiltroCategoria]   = useState(FILTRO_TODOS)
  const [filtroRecorrencia, setFiltroRecorrencia] = useState(FILTRO_TODOS)
  const [filtroStatus,      setFiltroStatus]      = useState(FILTRO_TODOS)
  const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(false)
  const [gruposExpandidos, setGruposExpandidos] = useState({})

  // Modais / ações
  const [modalCadastro,  setModalCadastro]  = useState(false)
  const [modalEdicao,    setModalEdicao]    = useState(null)
  const [confirmExcluir, setConfirmExcluir] = useState(null)
  const [excluindo,      setExcluindo]      = useState(false)
  const [erroExcluir,    setErroExcluir]    = useState('')
  const [modoSelecao, setModoSelecao] = useState(false)
  const [contasSelecionadas, setContasSelecionadas] = useState(() => new Set())
  const [excluindoSelecionadas, setExcluindoSelecionadas] = useState(false)
  const [erroExclusaoLote, setErroExclusaoLote] = useState('')

  const fetchData = useCallback(async () => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    setLoading(true)
    const [
      { data: cs },
      { data: ts },
      { data: ccs },
      { data: cats },
      { data: lancs },
    ] = await Promise.all([
      supabase.from('contas').select(`
        *,
        centros_custo:centros_custo!contas_workspace_centro_fkey(nome, tipo),
        categorias:categorias!contas_workspace_categoria_fkey(nome, icone),
        titulares:titulares!contas_workspace_titular_fkey(nome, cor),
        contas_titulares:contas_titulares!contas_titulares_workspace_conta_fkey(
          titular_id, inicio, fim,
          titulares:titulares!contas_titulares_workspace_titular_fkey(nome, cor)
        )
      `).eq('workspace_id', workspaceId).order('nome'),
      supabase.from('titulares').select('*').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('centros_custo').select('*').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('categorias').select('*').eq('workspace_id', workspaceId).order('nome'),
      supabase
        .from('lancamentos')
        .select('id, conta_id, vencimento, status')
        .eq('workspace_id', workspaceId),
    ])
    setContas(cs ?? [])
    setTitulares(ts ?? [])
    setCentrosCusto(ccs ?? [])
    setCategorias(cats ?? [])
    setLancamentos(lancs ?? [])
    setLoading(false)
  }, [workspaceId, loadingWorkspace, erroWorkspace])

  useEffect(() => { fetchData() }, [fetchData])

  // Filtros em tempo real
  const contasFiltradas = useMemo(() => {
    const termo = normalizarBusca(busca)

    return contas.filter(c => {
      if (termo && !normalizarBusca(c.nome).includes(termo)) return false

      if (filtroTitular !== FILTRO_TODOS) {
        const ctAtivo = c.contas_titulares?.find(ct => ct.fim === null)
        const idAtual = ctAtivo?.titular_id ?? c.titular_id
        if (filtroTitular === FILTRO_SEM_TITULAR) {
          if (idAtual) return false
        } else if (idAtual !== filtroTitular) {
          return false
        }
      }

      if (filtroCentro !== FILTRO_TODOS) {
        if (filtroCentro === FILTRO_GERAL) {
          if (c.centro_id) return false
        } else if (c.centro_id !== filtroCentro) {
          return false
        }
      }

      if (filtroCategoria !== FILTRO_TODOS && c.categoria_id !== filtroCategoria) return false
      if (filtroRecorrencia !== FILTRO_TODOS && c.recorrencia !== filtroRecorrencia) return false
      if (filtroStatus !== FILTRO_TODOS && c.status_contrato !== filtroStatus) return false
      return true
    })
  }, [contas, busca, filtroTitular, filtroCentro, filtroCategoria, filtroRecorrencia, filtroStatus])

  const hojeISO = useMemo(() => localISODate(new Date()), [])

  const lancamentosPorContaVencimento = useMemo(() => {
    const map = new Map()
    lancamentos.forEach(lancamento => {
      const chave = chaveLancamento(lancamento.conta_id, lancamento.vencimento)
      if (chave) {
        const atual = map.get(chave)
        if (!atual || (atual.status === 'pago' && lancamento.status !== 'pago')) {
          map.set(chave, lancamento)
        }
      }
    })
    return map
  }, [lancamentos])

  const lancamentosPorConta = useMemo(() => {
    const map = new Map()
    lancamentos.forEach(lancamento => {
      if (!lancamento.conta_id) return

      const vencimentoISO = normalizarDataISO(lancamento.vencimento)
      if (!vencimentoISO) return

      const lista = map.get(lancamento.conta_id) ?? []
      lista.push({ ...lancamento, vencimentoISO })
      map.set(lancamento.conta_id, lista)
    })
    return map
  }, [lancamentos])

  const contasFiltradasPorId = useMemo(() => {
    return new Map(contasFiltradas.map(conta => [conta.id, conta]))
  }, [contasFiltradas])

  const contasAgrupadas = useMemo(() => {
    const inicial = {
      vencidas: [],
      hoje: [],
      proximas: [],
      futuras: [],
      pagas: [],
    }

    contasFiltradas.forEach(conta => {
      const { grupo } = grupoVencimentoConta(conta, hojeISO, lancamentosPorContaVencimento, lancamentosPorConta)
      if (grupo === 'pagas') return
      inicial[grupo].push(conta)
    })

    lancamentos.forEach(lancamento => {
      if (lancamento.status !== 'pago') return

      const conta = contasFiltradasPorId.get(lancamento.conta_id)
      if (!conta) return

      const vencimentoISO = normalizarDataISO(lancamento.vencimento)
      if (!vencimentoISO) return

      inicial.pagas.push({
        ...conta,
        __itemKey: `${conta.id}|${vencimentoISO}|${lancamento.id}`,
        __lancamentoPago: {
          ...lancamento,
          vencimentoISO,
        },
      })
    })

    Object.keys(inicial).forEach(grupo => {
      if (grupo === 'pagas') {
        inicial[grupo].sort((a, b) => (
          (b.__lancamentoPago?.vencimentoISO ?? '').localeCompare(a.__lancamentoPago?.vencimentoISO ?? '')
          || (a.nome ?? '').localeCompare(b.nome ?? '')
        ))
        return
      }

      inicial[grupo].sort((a, b) => ordenarPorVencimento(a, b, hojeISO, lancamentosPorContaVencimento, lancamentosPorConta))
    })

    return inicial
  }, [contasFiltradas, contasFiltradasPorId, hojeISO, lancamentos, lancamentosPorContaVencimento, lancamentosPorConta])

  const filtrosAtivos = (
    busca.trim() !== ''
    || filtroCentro !== FILTRO_TODOS
    || filtroTitular !== FILTRO_TODOS
    || filtroCategoria !== FILTRO_TODOS
    || filtroStatus !== FILTRO_TODOS
    || filtroRecorrencia !== FILTRO_TODOS
  )

  const quantidadeFiltrosAtivos = [
    busca.trim() !== '',
    filtroCentro !== FILTRO_TODOS,
    filtroTitular !== FILTRO_TODOS,
    filtroCategoria !== FILTRO_TODOS,
    filtroStatus !== FILTRO_TODOS,
    filtroRecorrencia !== FILTRO_TODOS,
  ].filter(Boolean).length

  // ── Handlers ──

  function toggleGrupo(chaveGrupo) {
    setGruposExpandidos(prev => ({
      ...prev,
      [chaveGrupo]: !prev[chaveGrupo],
    }))
  }

  function limparFiltros() {
    setBusca('')
    setFiltroCentro(FILTRO_TODOS)
    setFiltroTitular(FILTRO_TODOS)
    setFiltroCategoria(FILTRO_TODOS)
    setFiltroStatus(FILTRO_TODOS)
    setFiltroRecorrencia(FILTRO_TODOS)
  }

  function handleContaSalva(data) {
    setContas(prev => {
      const existe = prev.find(c => c.id === data.id)
      const lista = existe
        ? prev.map(c => (c.id === data.id ? data : c))
        : [...prev, data]
      return lista.sort((a, b) => a.nome.localeCompare(b.nome))
    })
    setModalCadastro(false)
    setModalEdicao(null)
  }

  async function excluirContaPorId(contaId) {
    const hoje = localISODate(new Date())

    const { error: erroLanc } = await supabase
      .from('lancamentos')
      .delete()
      .eq('conta_id', contaId)
      .eq('workspace_id', workspaceId)
      .neq('status', 'pago')
      .gte('vencimento', hoje)

    if (erroLanc) throw erroLanc

    const { error: erroConta } = await supabase
      .from('contas')
      .delete()
      .eq('id', contaId)
      .eq('workspace_id', workspaceId)

    if (erroConta) throw erroConta
  }

  async function handleExcluir() {
    if (!confirmExcluir) return
    setErroExcluir('')
    setExcluindo(true)

    try {
      await excluirContaPorId(confirmExcluir.id)
      setContas(prev => prev.filter(c => c.id !== confirmExcluir.id))
      setConfirmExcluir(null)
    } catch (error) {
      registrarErroDesenvolvimento('Erro ao excluir conta:', error)
      setErroExcluir('Erro ao excluir conta. Tente novamente.')
    } finally {
      setExcluindo(false)
    }
  }

  function toggleSelecionarConta(contaId) {
    setContasSelecionadas(prev => {
      const proxima = new Set(prev)
      if (proxima.has(contaId)) proxima.delete(contaId)
      else proxima.add(contaId)
      return proxima
    })
    setErroExclusaoLote('')
  }

  function selecionarTodasVisiveis() {
    setContasSelecionadas(new Set(contasFiltradas.map(conta => conta.id)))
    setErroExclusaoLote('')
  }

  function limparSelecao() {
    setContasSelecionadas(new Set())
    setErroExclusaoLote('')
  }

  function cancelarSelecao() {
    limparSelecao()
    setModoSelecao(false)
  }

  async function excluirSelecionadas() {
    const ids = [...contasSelecionadas]
    if (ids.length === 0) return

    const confirmou = window.confirm(
      `Tem certeza que deseja excluir ${ids.length} ${ids.length === 1 ? 'conta' : 'contas'}?\n\n` +
      'Essa ação também pode remover lançamentos relacionados, dependendo das regras do banco.'
    )
    if (!confirmou) return

    setErroExclusaoLote('')
    setExcluindoSelecionadas(true)

    const excluidas = []
    const falhas = []

    for (const contaId of ids) {
      try {
        await excluirContaPorId(contaId)
        excluidas.push(contaId)
      } catch (error) {
        falhas.push(contaId)
        registrarErroDesenvolvimento(`Erro ao excluir conta ${contaId} em lote:`, error)
      }
    }

    if (excluidas.length > 0) {
      const idsExcluidos = new Set(excluidas)
      setContas(prev => prev.filter(conta => !idsExcluidos.has(conta.id)))
    }

    if (falhas.length > 0) {
      setContasSelecionadas(new Set(falhas))
      setErroExclusaoLote(
        `${falhas.length} ${falhas.length === 1 ? 'conta não pôde' : 'contas não puderam'} ser excluída${falhas.length === 1 ? '' : 's'}. Tente novamente.`
      )
    } else {
      setContasSelecionadas(new Set())
      setModoSelecao(false)
    }

    setExcluindoSelecionadas(false)
  }

  // ── Render ──

  if (erroWorkspace) {
    return <p className="text-sm text-red-500">{erroWorkspace}</p>
  }

  if (loadingWorkspace || loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 size={20} className="animate-spin text-slate-300" />
      </div>
    )
  }

  const selectClass =
    'w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition shadow-sm shadow-slate-200/40'
  const inputClass =
    'w-full border border-slate-200 rounded-xl py-2.5 pl-9 pr-4 text-sm text-slate-700 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition shadow-sm shadow-slate-200/40'

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contas</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Carteira de contas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Controle vencimentos, titulares e contratos ativos em um só lugar.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right shadow-sm shadow-slate-200/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Exibindo</p>
            <p className="text-sm font-bold text-slate-950 tabular-nums">
              {contasFiltradas.length}{' '}
              <span className="font-semibold text-slate-500">
                {contasFiltradas.length === 1 ? 'conta' : 'contas'}
              </span>
            </p>
          </div>
          <button
            onClick={() => setModalCadastro(true)}
            className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm shadow-slate-300"
          >
            <Plus size={14} />
            Nova conta
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-950">Filtros e busca</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Encontre contas por nome e refine a carteira quando precisar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFiltrosAvancadosAbertos(aberto => !aberto)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                quantidadeFiltrosAtivos > 0
                  ? 'border-slate-300 bg-slate-900 text-white hover:bg-slate-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal size={13} />
              Filtros avançados
              {quantidadeFiltrosAtivos > 0 && (
                <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                  {quantidadeFiltrosAtivos} {quantidadeFiltrosAtivos === 1 ? 'ativo' : 'ativos'}
                </span>
              )}
              {filtrosAvancadosAbertos ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <button
              onClick={limparFiltros}
              disabled={!filtrosAtivos}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Buscar conta</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome"
              className={inputClass}
            />
          </div>
        </div>

        {filtrosAvancadosAbertos && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-slate-100 pt-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Imóvel</label>
              <select value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)} className={selectClass}>
                <option value={FILTRO_TODOS}>Todos</option>
                <option value={FILTRO_GERAL}>Geral / Sem imóvel</option>
                {centrosCusto.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Titular</label>
            <select value={filtroTitular} onChange={e => setFiltroTitular(e.target.value)} className={selectClass}>
              <option value={FILTRO_TODOS}>Todos</option>
              <option value={FILTRO_SEM_TITULAR}>Sem titular</option>
              {titulares.map(t => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Categoria</label>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} className={selectClass}>
              <option value={FILTRO_TODOS}>Todas</option>
              {categorias.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Status/contrato</label>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} className={selectClass}>
              <option value={FILTRO_TODOS}>Todos</option>
              <option value="ativo">Ativo</option>
              <option value="a_fazer">A fazer</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Recorrência</label>
            <select value={filtroRecorrencia} onChange={e => setFiltroRecorrencia(e.target.value)} className={selectClass}>
              <option value={FILTRO_TODOS}>Todas</option>
              <option value="uma_vez">Uma vez</option>
              <option value="mensal">Mensal</option>
              <option value="anual">Anual</option>
            </select>
          </div>
          </div>
        )}
      </div>

      {/* Gerenciamento em lote */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm shadow-slate-200/60">
        <div>
          <p className="text-sm font-semibold text-slate-950">Operações em lote</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {modoSelecao
              ? `${contasSelecionadas.size} ${contasSelecionadas.size === 1 ? 'conta selecionada' : 'contas selecionadas'}`
              : 'Selecione uma ou mais contas para excluir em lote.'}
          </p>
          {erroExclusaoLote && <p className="text-xs text-red-500 mt-1.5">{erroExclusaoLote}</p>}
        </div>

        {modoSelecao ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={selecionarTodasVisiveis}
              disabled={excluindoSelecionadas || contasFiltradas.length === 0}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Selecionar visíveis
            </button>
            {contasSelecionadas.size > 0 && (
              <button
                onClick={limparSelecao}
                disabled={excluindoSelecionadas}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              >
                Limpar seleção
              </button>
            )}
            {contasSelecionadas.size > 0 && (
              <button
                onClick={excluirSelecionadas}
                disabled={excluindoSelecionadas}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {excluindoSelecionadas
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Trash2 size={13} />}
                {excluindoSelecionadas ? 'Excluindo...' : 'Excluir selecionadas'}
              </button>
            )}
            <button
              onClick={cancelarSelecao}
              disabled={excluindoSelecionadas}
              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-40 transition-colors"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setModoSelecao(true); setErroExclusaoLote('') }}
            disabled={contasFiltradas.length === 0}
            className="self-start sm:self-auto px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            Selecionar contas
          </button>
        )}
      </div>

      {/* Lista de cards agrupada por vencimento */}
      {contasFiltradas.length === 0 ? (
        contas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white py-16 px-4 text-center shadow-sm shadow-slate-200/60">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <Inbox size={20} className="text-slate-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-950">Nenhuma conta cadastrada.</p>
              <p className="text-xs text-slate-500 max-w-xs">
                Crie sua primeira conta para acompanhar vencimentos, pagamentos e comprovantes.
              </p>
            </div>
            <button
              onClick={() => setModalCadastro(true)}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              <Plus size={14} />
              Nova conta
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white py-16 px-4 text-center shadow-sm shadow-slate-200/60">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <Search size={20} className="text-slate-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-950">Nenhuma conta encontrada.</p>
              <p className="text-xs text-slate-500 max-w-xs">
                Tente ajustar a busca ou limpar os filtros para ver mais contas.
              </p>
            </div>
            <button
              onClick={limparFiltros}
              className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {GRUPOS_VENCIMENTO.map(grupo => (
            <SecaoGrupoContas
              key={grupo.chave}
              grupo={grupo}
              contas={contasAgrupadas[grupo.chave]}
              expandido={Boolean(gruposExpandidos[grupo.chave])}
              onToggleExpandido={() => toggleGrupo(grupo.chave)}
              modoSelecao={modoSelecao}
              contasSelecionadas={contasSelecionadas}
              onSelecionar={toggleSelecionarConta}
              onEditar={setModalEdicao}
              onExcluir={(conta) => { setErroExcluir(''); setConfirmExcluir(conta) }}
              onVerLancamentos={(conta) => navigate('/', { state: { contaId: conta.id } })}
            />
          ))}
        </div>
      )}

      {/* Modal confirmação de exclusão */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
          <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Excluir conta</h2>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                Excluir{' '}
                <span className="font-semibold text-slate-800">{confirmExcluir.nome}</span>?
                Lançamentos futuros não pagos serão removidos. Esta ação não pode ser desfeita.
              </p>
            </div>
            {erroExcluir && <p className="text-red-500 text-xs">{erroExcluir}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmExcluir(null)}
                disabled={excluindo}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleExcluir}
                disabled={excluindo}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {excluindo && <Loader2 size={14} className="animate-spin" />}
                {excluindo ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cadastro */}
      {modalCadastro && (
        <ModalFormConta
          conta={null}
          centroIdInicial={filtroCentro !== FILTRO_TODOS && filtroCentro !== FILTRO_GERAL ? filtroCentro : ''}
          centrosCusto={centrosCusto}
          titulares={titulares}
          categorias={categorias}
          onClose={() => setModalCadastro(false)}
          onSalvo={handleContaSalva}
        />
      )}

      {/* Modal de edição */}
      {modalEdicao && (
        <ModalFormConta
          conta={modalEdicao}
          centrosCusto={centrosCusto}
          titulares={titulares}
          categorias={categorias}
          onClose={() => setModalEdicao(null)}
          onSalvo={handleContaSalva}
        />
      )}

    </div>
  )
}
