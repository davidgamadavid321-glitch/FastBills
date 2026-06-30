import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Plus, MoreVertical, Loader2, Tag, Trash2 } from 'lucide-react'
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
          <p className="text-xs text-slate-700 font-semibold truncate mt-0.5">
            {conta.centros_custo?.nome ?? 'Geral'}
          </p>
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

// ── Página principal ─────────────────────────────────────────

export default function Contas() {
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()

  const [contas, setContas]             = useState([])
  const [titulares, setTitulares]       = useState([])
  const [centrosCusto, setCentrosCusto] = useState([])
  const [categorias, setCategorias]     = useState([])
  const [loading, setLoading]           = useState(true)

  // Filtros — pré-preenche centro se vindo de Imóveis
  const [filtroTitular,     setFiltroTitular]     = useState('')
  const [filtroCentro,      setFiltroCentro]      = useState(location.state?.centroId ?? '')
  const [filtroRecorrencia, setFiltroRecorrencia] = useState('')
  const [filtroStatus,      setFiltroStatus]      = useState('')

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
    ])
    setContas(cs ?? [])
    setTitulares(ts ?? [])
    setCentrosCusto(ccs ?? [])
    setCategorias(cats ?? [])
    setLoading(false)
  }, [workspaceId, loadingWorkspace, erroWorkspace])

  useEffect(() => { fetchData() }, [fetchData])

  // Filtros em tempo real
  const contasFiltradas = useMemo(() => {
    return contas.filter(c => {
      if (filtroTitular) {
        const ctAtivo = c.contas_titulares?.find(ct => ct.fim === null)
        const idAtual = ctAtivo?.titular_id ?? c.titular_id
        if (idAtual !== filtroTitular) return false
      }
      if (filtroCentro      && c.centro_id    !== filtroCentro)      return false
      if (filtroRecorrencia && c.recorrencia  !== filtroRecorrencia) return false
      if (filtroStatus      && c.status_contrato !== filtroStatus)   return false
      return true
    })
  }, [contas, filtroTitular, filtroCentro, filtroRecorrencia, filtroStatus])

  // ── Handlers ──

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
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Titular</label>
          <select value={filtroTitular} onChange={e => setFiltroTitular(e.target.value)} className={selectClass}>
            <option value="">Todos</option>
            {titulares.map(t => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Imóvel</label>
          <select value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)} className={selectClass}>
            <option value="">Todos</option>
            {centrosCusto.map(c => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Recorrência</label>
          <select value={filtroRecorrencia} onChange={e => setFiltroRecorrencia(e.target.value)} className={selectClass}>
            <option value="">Todas</option>
            <option value="uma_vez">Uma vez</option>
            <option value="mensal">Mensal</option>
            <option value="anual">Anual</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">Status</label>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} className={selectClass}>
            <option value="">Todos</option>
            <option value="ativo">Ativo</option>
            <option value="a_fazer">A fazer</option>
          </select>
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
              Selecionar todas
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

      {/* Lista de cards */}
      {contasFiltradas.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-slate-400">Nenhuma conta encontrada.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {contasFiltradas.map(conta => (
            <CardConta
              key={conta.id}
              conta={conta}
              modoSelecao={modoSelecao}
              selecionada={contasSelecionadas.has(conta.id)}
              onSelecionar={toggleSelecionarConta}
              onEditar={() => setModalEdicao(conta)}
              onExcluir={() => { setErroExcluir(''); setConfirmExcluir(conta) }}
              onVerLancamentos={() => navigate('/', { state: { contaId: conta.id } })}
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
          centroIdInicial={filtroCentro}
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
