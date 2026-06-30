import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Plus, MoreVertical, Loader2, Tag, Trash2, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { localISODate } from '../lib/utils'
import ModalFormConta from '../components/ModalFormConta'

// ── Helpers ──────────────────────────────────────────────────

function formatarValor(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor ?? 0)
}

const RECORRENCIA_LABEL = {
  uma_vez: 'Uma vez',
  mensal:  'Mensal',
  anual:   'Anual',
}

const FILTRO_TODOS = 'todos'
const FILTRO_GERAL = 'geral'
const FILTRO_SEM_TITULAR = 'sem_titular'
const DIAS_PROXIMAS = 7

const GRUPOS_VENCIMENTO = [
  {
    chave: 'vencidas',
    titulo: '🔴 Vencidas',
    descricao: 'Contas com vencimento anterior a hoje',
    classe: 'border-red-200 bg-red-50/70',
  },
  {
    chave: 'hoje',
    titulo: '🟡 Vencem hoje',
    descricao: 'Prioridade do dia',
    classe: 'border-amber-200 bg-amber-50/70',
  },
  {
    chave: 'proximas',
    titulo: '🟢 Próximas',
    descricao: `Vencem em até ${DIAS_PROXIMAS} dias`,
    classe: 'border-green-200 bg-green-50/60',
  },
  {
    chave: 'futuras',
    titulo: '⚪ Futuras',
    descricao: 'Vencimentos depois desse período',
    classe: 'border-slate-200 bg-white',
  },
  {
    chave: 'pagas',
    titulo: '✅ Pagas',
    descricao: 'Contas já pagas no vencimento atual',
    classe: 'border-green-200 bg-green-50/60',
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
  return `${contaId}:${vencimento}`
}

function grupoVencimentoConta(conta, hojeISO, lancamentosPorContaVencimento) {
  const vencimento = dataVencimentoReferencia(conta, hojeISO)
  if (!vencimento) return { grupo: 'futuras', vencimento: '9999-12-31' }

  const lancamento = lancamentosPorContaVencimento.get(chaveLancamento(conta.id, vencimento))
  if (lancamento?.status === 'pago') return { grupo: 'pagas', vencimento }

  if (vencimento < hojeISO) return { grupo: 'vencidas', vencimento }
  if (vencimento === hojeISO) return { grupo: 'hoje', vencimento }
  if (vencimento <= somarDiasISO(hojeISO, DIAS_PROXIMAS)) return { grupo: 'proximas', vencimento }
  return { grupo: 'futuras', vencimento }
}

function ordenarPorVencimento(a, b, hojeISO) {
  const vencimentoA = dataVencimentoReferencia(a, hojeISO)
  const vencimentoB = dataVencimentoReferencia(b, hojeISO)
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
      className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-slate-50 ${
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
    if (!conta.dia_vencimento) return null
    if (conta.recorrencia === 'anual' && conta.mes_vencimento) {
      const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                     'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
      return `Dia ${conta.dia_vencimento} de ${meses[conta.mes_vencimento - 1]}`
    }
    return `Todo dia ${conta.dia_vencimento}`
  })()

  return (
    <div className={`bg-white rounded-2xl border p-5 flex flex-col gap-3 ${
      selecionada ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200'
    }`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {modoSelecao && (
            <input
              type="checkbox"
              checked={selecionada}
              onChange={() => onSelecionar(conta.id)}
              aria-label={`Selecionar ${conta.nome}`}
              className="mt-2.5 h-4 w-4 shrink-0 accent-slate-900"
            />
          )}
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: cor ? `${cor}22` : '#f1f5f9' }}
          >
            <IconeLucide
              nome={conta.categorias?.icone}
              size={19}
              style={{ color: cor ?? '#64748b' }}
            />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 leading-tight truncate">{conta.nome}</p>
            <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: cor ?? '#64748b' }}>
              {titular?.nome ?? 'Sem titular'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
              isAtivo ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isAtivo ? 'Ativo' : 'A fazer'}
          </span>
          {!modoSelecao && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuAberto(m => !m)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <MoreVertical size={16} className="text-slate-400" />
              </button>
              {menuAberto && (
                <div className="absolute right-0 top-8 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 w-44 z-20">
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-3 border-t border-slate-100">
        <div>
          <p className="text-[11px] text-slate-400 font-medium">Centro de custo</p>
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold leading-none ${centro.badgeClass}`}>
              {centro.badge}
            </span>
            <span className="min-w-0 truncate text-xs text-slate-700 font-semibold">
              {centro.nome}
            </span>
          </div>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 font-medium">Recorrência</p>
          <p className="text-xs text-slate-700 font-semibold mt-0.5">{RECORRENCIA_LABEL[conta.recorrencia] ?? '—'}</p>
        </div>
        {vencimentoLabel && (
          <div>
            <p className="text-[11px] text-slate-400 font-medium">Vencimento</p>
            <p className="text-xs text-slate-700 font-semibold mt-0.5">{vencimentoLabel}</p>
          </div>
        )}
        {conta.valor_referencia != null && (
          <div>
            <p className="text-[11px] text-slate-400 font-medium">Valor de referência</p>
            <p className="text-xs text-slate-900 font-bold mt-0.5">{formatarValor(conta.valor_referencia)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SecaoGrupoContas({
  grupo,
  contas,
  modoSelecao,
  contasSelecionadas,
  onSelecionar,
  onEditar,
  onExcluir,
  onVerLancamentos,
}) {
  if (contas.length === 0) return null

  return (
    <section className={`rounded-2xl border p-3 sm:p-4 space-y-3 ${grupo.classe}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900">{grupo.titulo}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{grupo.descricao}</p>
        </div>
        <span className="shrink-0 text-[11px] font-bold text-slate-600 bg-white/80 border border-black/5 rounded-full px-2 py-1">
          {contas.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {contas.map(conta => (
          <CardConta
            key={conta.id}
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
      if (lancamento.conta_id && lancamento.vencimento) {
        map.set(chaveLancamento(lancamento.conta_id, lancamento.vencimento), lancamento)
      }
    })
    return map
  }, [lancamentos])

  const contasAgrupadas = useMemo(() => {
    const inicial = {
      vencidas: [],
      hoje: [],
      proximas: [],
      futuras: [],
      pagas: [],
    }

    contasFiltradas.forEach(conta => {
      const { grupo } = grupoVencimentoConta(conta, hojeISO, lancamentosPorContaVencimento)
      inicial[grupo].push(conta)
    })

    Object.keys(inicial).forEach(grupo => {
      inicial[grupo].sort((a, b) => ordenarPorVencimento(a, b, hojeISO))
    })

    return inicial
  }, [contasFiltradas, hojeISO, lancamentosPorContaVencimento])

  const filtrosAtivos = (
    busca.trim() !== ''
    || filtroCentro !== FILTRO_TODOS
    || filtroTitular !== FILTRO_TODOS
    || filtroCategoria !== FILTRO_TODOS
    || filtroStatus !== FILTRO_TODOS
    || filtroRecorrencia !== FILTRO_TODOS
  )

  // ── Handlers ──

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
    'w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition'
  const inputClass =
    'w-full border border-slate-300 rounded-xl py-2.5 pl-9 pr-4 text-sm text-slate-700 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 transition'

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {contasFiltradas.length}{' '}
          {contasFiltradas.length === 1 ? 'conta cadastrada' : 'contas cadastradas'}
        </p>
        <button
          onClick={() => setModalCadastro(true)}
          className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
        >
          <Plus size={14} />
          Adicionar
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-slate-900">Filtros</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {contasFiltradas.length} {contasFiltradas.length === 1 ? 'conta encontrada' : 'contas encontradas'}
            </p>
          </div>
          <button
            onClick={limparFiltros}
            disabled={!filtrosAtivos}
            className="self-start sm:self-auto px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            Limpar filtros
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
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
      </div>

      {/* Gerenciamento em lote */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Gerenciar contas</p>
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
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-slate-400">Nenhuma conta encontrada.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {GRUPOS_VENCIMENTO.map(grupo => (
            <SecaoGrupoContas
              key={grupo.chave}
              grupo={grupo}
              contas={contasAgrupadas[grupo.chave]}
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
