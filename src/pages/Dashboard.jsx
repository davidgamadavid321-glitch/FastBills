import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { formatarMoeda as formatarValor, localISODate, normalizarDataISO } from '../lib/utils'
import ModalCadastroConta from '../components/ModalCadastroConta'
import ModalDetalheLancamento from '../components/ModalDetalheLancamento'

// ── Constantes ───────────────────────────────────────────────

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// ── Utilitários ──────────────────────────────────────────────

function formatarData(iso = '') {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function statusEfetivo(vencimento, status, hoje) {
  const vencimentoISO = normalizarDataISO(vencimento)
  if (status === 'pago') return 'pago'
  if (!vencimentoISO) return 'pendente'
  if (status === 'vencido' || vencimentoISO < hoje) return 'vencido'
  if (vencimentoISO === hoje) return 'hoje'
  return 'pendente'
}

const PRIORIDADE = { vencido: 0, hoje: 1, pendente: 2, pago: 3 }

function piorStatusDia(lancamentos, hoje) {
  const statuses = lancamentos.map(l => statusEfetivo(l.vencimento, l.status, hoje))
  return statuses.reduce((pior, s) => (PRIORIDADE[s] < PRIORIDADE[pior] ? s : pior))
}

function buildGrid(date) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const diasMes = new Date(y, m + 1, 0).getDate()
  const inicioSemana = new Date(y, m, 1).getDay()
  const cells = Array(inicioSemana).fill(null)
  for (let d = 1; d <= diasMes; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function titularDoConta(conta) {
  const ctAtivo = conta?.contas_titulares?.find(ct => ct.fim === null)
  return ctAtivo?.titulares ?? conta?.titulares ?? null
}

function titularIdDoConta(conta) {
  const ctAtivo = conta?.contas_titulares?.find(ct => ct.fim === null)
  return ctAtivo?.titular_id ?? conta?.titular_id ?? null
}

// ── Mapas de estilo ──────────────────────────────────────────

const DIA_STATUS = {
  vencido: 'border-red-200 bg-red-50/80',
  hoje: 'border-amber-200 bg-amber-50/80',
  pendente: 'border-slate-200 bg-slate-50',
  pago: 'border-green-200 bg-green-50/70',
}

const BADGE_COR = {
  pago: 'bg-green-100 text-green-700',
  vencido: 'bg-red-100 text-red-700',
  hoje: 'bg-amber-100 text-amber-800',
  pendente: 'bg-slate-100 text-slate-600',
}

const STATUS_LABEL = { pago: 'Pago', vencido: 'Vencido', hoje: 'Vence hoje', pendente: 'Pendente' }

// ── Sub-componentes ──────────────────────────────────────────

function MiniLancamentoDia({ lancamento, selecionado, hoje }) {
  const s = statusEfetivo(lancamento.vencimento, lancamento.status, hoje)
  const cor = titularDoConta(lancamento.contas)?.cor
  const nome = lancamento.contas?.nome ?? 'Conta'

  return (
    <div
      className={`min-w-0 rounded-lg px-1.5 py-1 border ${
        selecionado
          ? 'bg-white/15 border-white/20 text-white'
          : 'bg-white/85 border-black/5 text-slate-700'
      }`}
      style={!selecionado && cor ? { borderLeftColor: cor, borderLeftWidth: 3 } : undefined}
      title={`${nome} - ${formatarValor(lancamento.valor)}`}
    >
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className="text-[10px] sm:text-[11px] font-semibold truncate min-w-0">
          {nome}
        </span>
        <span
          className={`hidden sm:inline text-[10px] font-bold shrink-0 ${
            selecionado ? 'text-white' : s === 'vencido' ? 'text-red-700' : 'text-slate-900'
          }`}
        >
          {formatarValor(lancamento.valor)}
        </span>
      </div>
    </div>
  )
}

function DiaCell({ dia, lancamentos, selecionado, ehHoje, hoje, onClick }) {
  if (dia === null) return <div className="min-h-[74px] sm:min-h-[108px] rounded-xl border border-transparent" />

  const temContas = lancamentos.length > 0
  const pior = temContas ? piorStatusDia(lancamentos, hoje) : null
  const visiveis = lancamentos.slice(0, 2)
  const excedente = lancamentos.length - visiveis.length

  const estado = selecionado
    ? 'border-slate-900 bg-slate-900 shadow-sm'
    : pior
    ? DIA_STATUS[pior]
    : ehHoje
    ? 'border-blue-200 bg-blue-50'
    : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'

  return (
    <div
      className={`rounded-xl sm:rounded-2xl border p-1.5 sm:p-2 min-h-[74px] sm:min-h-[108px] cursor-pointer transition-all select-none flex flex-col gap-1.5 ${estado}`}
      onClick={() => onClick(dia, temContas)}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`h-5 min-w-5 px-1.5 rounded-full text-xs font-black leading-5 text-center ${
            selecionado
              ? 'bg-white text-slate-900'
              : ehHoje
              ? 'bg-blue-600 text-white'
              : 'text-slate-700'
          }`}
        >
          {dia}
        </span>
        {temContas && (
          <span
            className={`text-[10px] font-bold leading-none ${
              selecionado ? 'text-white/70' : 'text-slate-400'
            }`}
          >
            {lancamentos.length}
          </span>
        )}
      </div>

      <div className="min-w-0 space-y-1">
        {visiveis.map(l => (
          <MiniLancamentoDia key={l.id} lancamento={l} selecionado={selecionado} hoje={hoje} />
        ))}
        {excedente > 0 && (
          <span
            className={`block text-[10px] font-semibold leading-none px-1 ${
              selecionado ? 'text-white/65' : 'text-slate-500'
            }`}
          >
            + {excedente} conta{excedente > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function CardLancamento({ lancamento, hoje, onClick }) {
  const s = statusEfetivo(lancamento.vencimento, lancamento.status, hoje)
  const titular = titularDoConta(lancamento.contas)
  const cor = titular?.cor

  return (
    <div
      className="rounded-xl border p-3 space-y-2 cursor-pointer hover:shadow-sm transition-shadow"
      style={cor
        ? { borderColor: `${cor}66`, backgroundColor: `${cor}10` }
        : { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }
      }
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate" style={{ color: cor ?? '#64748b' }}>
            {titular?.nome ?? 'Sem titular'}
          </p>
          <p className="text-sm font-semibold text-slate-900 truncate">
            {lancamento.contas?.nome ?? '—'}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {lancamento.contas?.centros_custo?.nome ?? 'Geral'}
          </p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${BADGE_COR[s]}`}>
          {STATUS_LABEL[s]}
        </span>
      </div>
      <div className="flex items-center justify-between pt-1.5 border-t border-black/5">
        <p className="text-xs text-slate-400">{formatarData(lancamento.vencimento)}</p>
        <p className="text-sm font-bold text-slate-900">{formatarValor(lancamento.valor)}</p>
      </div>
    </div>
  )
}

function PainelDia({ dia, lancamentos, ehHoje, hoje, onAdicionar, onCardClick }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {ehHoje ? 'Hoje' : `Dia ${dia}`}
        </h2>
        <button
          onClick={onAdicionar}
          className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-lg transition-colors"
        >
          <Plus size={13} />
          Adicionar
        </button>
      </div>

      {lancamentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-slate-400 text-sm">Nenhuma conta</p>
          <button className="mt-1.5 text-xs text-slate-500 underline hover:text-slate-700">
            Adicionar conta
          </button>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto max-h-[60vh]">
          {lancamentos.map(l => (
            <CardLancamento key={l.id} lancamento={l} hoje={hoje} onClick={() => onCardClick?.(l)} />
          ))}
        </div>
      )}
    </>
  )
}

// ── Componente principal ─────────────────────────────────────

export default function Dashboard() {
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [lancamentos, setLancamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState('')
  const [selectedDay, setSelectedDay] = useState(null)
  const [filterTitular, setFilterTitular] = useState('')
  const [filterStatus, setFilterStatus] = useState('todos')
  const [modal, setModal] = useState({ aberto: false, dia: null })
  const [detalhe, setDetalhe] = useState(null)

  const hoje = useMemo(() => localISODate(new Date()), [])

  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return (
      currentMonth.getFullYear() === now.getFullYear() &&
      currentMonth.getMonth() === now.getMonth()
    )
  }, [currentMonth])

  const hojeNum = isCurrentMonth ? parseInt(hoje.split('-')[2], 10) : -1

  useEffect(() => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    const y = currentMonth.getFullYear()
    const m = currentMonth.getMonth()
    const inicio = localISODate(new Date(y, m, 1))
    const fim    = localISODate(new Date(y, m + 1, 0))

    setLoading(true)
    setErroCarregamento('')
    setSelectedDay(null)

    const CONTAS_SELECT = `
      nome, recorrencia, categoria_id, centro_id, titular_id,
      categorias:categorias!contas_workspace_categoria_fkey(nome, icone),
      centros_custo:centros_custo!contas_workspace_centro_fkey(nome),
      titulares:titulares!contas_workspace_titular_fkey(nome, cor),
      contas_titulares:contas_titulares!contas_titulares_workspace_conta_fkey(
        titular_id, fim,
        titulares:titulares!contas_titulares_workspace_titular_fkey(nome, cor)
      )
    `

    async function carregar() {
      const { data, error } = await supabase
        .from('lancamentos')
        .select(`*, contas:contas!lancamentos_workspace_conta_fkey(${CONTAS_SELECT})`)
        .gte('vencimento', inicio)
        .lte('vencimento', fim)
        .eq('workspace_id', workspaceId)
        .order('vencimento')

      if (error) {
        if (import.meta.env.DEV) console.error('Erro ao carregar calendário:', error)
        setErroCarregamento('Não foi possível carregar o calendário. Tente novamente.')
        setLoading(false)
        return
      }

      const carregados = data ?? []

      // Verificar lançamentos anuais que ainda não foram gerados para este ano/mês
      const { data: contasAnuais } = await supabase
        .from('contas')
        .select('id, dia_vencimento, mes_vencimento, valor_referencia')
        .eq('recorrencia', 'anual')
        .eq('mes_vencimento', m + 1)
        .eq('status_contrato', 'ativo')
        .eq('workspace_id', workspaceId)

      if (contasAnuais?.length) {
        const jaExistem = new Set(carregados.map(l => l.conta_id))
        const faltando  = contasAnuais.filter(c => !jaExistem.has(c.id))

        if (faltando.length) {
          const agora = new Date()
          agora.setHours(0, 0, 0, 0)
          const anoAtual = agora.getFullYear()

          // Só criar se ano visualizado é o atual (permite vencido) ou data futura
          const payload = faltando.reduce((acc, c) => {
            const d = new Date(y, m, c.dia_vencimento)
            d.setHours(0, 0, 0, 0)
            if (y === anoAtual || d >= agora) {
              const vencimento = localISODate(d)
              acc.push({
                conta_id:   c.id,
                valor:      c.valor_referencia ?? 0,
                vencimento,
                status:     d < agora ? 'vencido' : 'pendente',
                workspace_id: workspaceId,
              })
            }
            return acc
          }, [])

          if (!payload.length) { setLancamentos(carregados); setLoading(false); return }

          try {
            await Promise.all(payload.map(async (novoLancamento) => {
              const { error: erroInsert } = await supabase
                .from('lancamentos')
                .insert(novoLancamento)

              if (erroInsert && erroInsert.code !== '23505') throw erroInsert
            }))
          } catch {
            setLancamentos(carregados)
            setLoading(false)
            return
          }
        }
      }

      const { data: atualizados, error: erroAtualizar } = await supabase
        .from('lancamentos')
        .select(`*, contas:contas!lancamentos_workspace_conta_fkey(${CONTAS_SELECT})`)
        .gte('vencimento', inicio)
        .lte('vencimento', fim)
        .eq('workspace_id', workspaceId)
        .order('vencimento')

      setLancamentos(erroAtualizar ? carregados : (atualizados ?? []))
      setLoading(false)
    }

    carregar()
  }, [currentMonth, workspaceId, loadingWorkspace, erroWorkspace])

  const titulares = useMemo(() => {
    const map = new Map()
    lancamentos.forEach(l => {
      const tid = titularIdDoConta(l.contas)
      const t = titularDoConta(l.contas)
      if (tid && t && !map.has(tid)) map.set(tid, { id: tid, nome: t.nome, cor: t.cor })
    })
    return Array.from(map.values())
  }, [lancamentos])

  const filtered = useMemo(() => {
    let r = lancamentos
    if (filterTitular) r = r.filter(l => titularIdDoConta(l.contas) === filterTitular)
    if (filterStatus !== 'todos')
      r = r.filter(l => statusEfetivo(l.vencimento, l.status, hoje) === filterStatus)
    return r
  }, [lancamentos, filterTitular, filterStatus, hoje])

  const byDay = useMemo(() => {
    const map = {}
    filtered.forEach(l => {
      const d = parseInt(normalizarDataISO(l.vencimento).split('-')[2], 10)
      if (!map[d]) map[d] = []
      map[d].push(l)
    })
    return map
  }, [filtered])

  const { numVencidos, numHoje, numPendentes, totalPago } = useMemo(() => {
    let numVencidos = 0, numHoje = 0, numPendentes = 0, totalPago = 0
    filtered.forEach(l => {
      const s = statusEfetivo(l.vencimento, l.status, hoje)
      if (s === 'vencido') numVencidos++
      else if (s === 'hoje') numHoje++
      else if (s === 'pendente') numPendentes++
      if (l.status === 'pago') totalPago += l.valor ?? 0
    })
    return { numVencidos, numHoje, numPendentes, totalPago }
  }, [filtered, hoje])

  const grid = useMemo(() => buildGrid(currentMonth), [currentMonth])
  const diaSelecionadoLancamentos = selectedDay ? (byDay[selectedDay] ?? []) : []
  const diaSelecionadoEhHoje = selectedDay === hojeNum

  function handleDiaClick(dia, temContas) {
    if (temContas) {
      setSelectedDay(d => (d === dia ? null : dia))
    } else {
      setModal({ aberto: true, dia })
    }
  }

  function abrirModalParaDia(dia) {
    setModal({ aberto: true, dia })
  }

  function fecharModal() {
    setModal({ aberto: false, dia: null })
  }

  function handleLancamentoAtualizado(lancamentoAtualizado) {
    setLancamentos(prev =>
      prev.map(l => (l.id === lancamentoAtualizado.id ? lancamentoAtualizado : l))
    )
  }

  function handleLancamentoExcluido(lancamentoId) {
    setLancamentos(prev => prev.filter(l => l.id !== lancamentoId))
    setDetalhe(null)
  }

  function handleContaSalva(novosLancamentos) {
    const y = currentMonth.getFullYear()
    const m = currentMonth.getMonth()
    const inicioMes = localISODate(new Date(y, m, 1))
    const fimMes = localISODate(new Date(y, m + 1, 0))

    const doMesAtual = novosLancamentos.filter(l => {
      const vencimento = normalizarDataISO(l.vencimento)
      return vencimento >= inicioMes && vencimento <= fimMes
    })

    if (doMesAtual.length > 0) {
      setLancamentos(prev => [...prev, ...doMesAtual])
    }

    fecharModal()
  }

  if (erroWorkspace) {
    return <p className="text-sm text-red-500">{erroWorkspace}</p>
  }

  return (
    <div className="space-y-4">

      {/* Banner de alertas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <div>
            <p className="text-xs text-red-600 font-medium mb-0.5">Vencidos</p>
            <p className="text-2xl font-black text-red-700 leading-none">{numVencidos}</p>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-600 font-medium mb-0.5">Vence hoje</p>
          <p className="text-2xl font-black text-amber-700 leading-none">{numHoje}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p className="text-xs text-slate-500 font-medium mb-0.5">Pendentes</p>
          <p className="text-2xl font-black text-slate-700 leading-none">{numPendentes}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <p className="text-xs text-green-600 font-medium mb-0.5">Total pago</p>
          <p className="text-base font-black text-green-700 leading-tight">{formatarValor(totalPago)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <select
          value={filterTitular}
          onChange={e => setFilterTitular(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
        >
          <option value="">Todos os titulares</option>
          {titulares.map(t => (
            <option key={t.id} value={t.id}>{t.nome}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
        >
          <option value="todos">Todos os status</option>
          <option value="pago">Pago</option>
          <option value="vencido">Vencido</option>
          <option value="hoje">Vence hoje</option>
          <option value="pendente">Pendente</option>
        </select>
      </div>

      {/* Calendário + Painel lateral */}
      <div className="flex gap-4 items-start">

        {/* Calendário */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 shadow-sm">

          {/* Navegação de mês */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Calendário
              </p>
              <h2 className="text-lg font-black text-slate-900 leading-tight">
                {NOMES_MESES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </h2>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2">
            <button
              onClick={() => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="h-9 w-9 border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-center shrink-0"
              title="Mês anterior"
            >
              <ChevronLeft size={17} className="text-slate-600" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              {/* Select de mês */}
              <div className="relative">
                <select
                  value={currentMonth.getMonth()}
                  onChange={e => setCurrentMonth(d => new Date(d.getFullYear(), parseInt(e.target.value), 1))}
                  className="appearance-none cursor-pointer border border-slate-200 rounded-xl pl-3 pr-7 py-2 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition max-w-[136px]"
                >
                  {NOMES_MESES.map((nome, i) => (
                    <option key={i} value={i}>{nome}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>

              {/* Select de ano */}
              <div className="relative">
                <select
                  value={currentMonth.getFullYear()}
                  onChange={e => setCurrentMonth(d => new Date(parseInt(e.target.value), d.getMonth(), 1))}
                  className="appearance-none cursor-pointer border border-slate-200 rounded-xl pl-3 pr-7 py-2 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
                >
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(ano => (
                    <option key={ano} value={ano}>{ano}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <button
              onClick={() => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="h-9 w-9 border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-center shrink-0"
              title="Próximo mês"
            >
              <ChevronRight size={17} className="text-slate-600" />
            </button>
            </div>
          </div>

          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {DIAS_SEMANA.map(d => (
              <p key={d} className="text-center text-[10px] sm:text-[11px] font-bold text-slate-400 py-1">
                {d}
              </p>
            ))}
          </div>

          {/* Grid de dias */}
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <span className="text-slate-400 text-sm">Carregando...</span>
            </div>
          ) : erroCarregamento ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-sm text-red-500">{erroCarregamento}</p>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {grid.map((dia, idx) => (
                <DiaCell
                  key={idx}
                  dia={dia}
                  lancamentos={dia ? (byDay[dia] ?? []) : []}
                  selecionado={dia !== null && dia === selectedDay}
                  ehHoje={dia === hojeNum}
                  hoje={hoje}
                  onClick={handleDiaClick}
                />
              ))}
            </div>
          )}
        </div>

        {/* Painel lateral — desktop */}
        {selectedDay && (
          <div className="hidden lg:flex lg:flex-col w-72 shrink-0 bg-white rounded-2xl border border-slate-200 p-4 gap-3">
            <PainelDia
              dia={selectedDay}
              lancamentos={diaSelecionadoLancamentos}
              ehHoje={diaSelecionadoEhHoje}
              hoje={hoje}
              onAdicionar={() => abrirModalParaDia(selectedDay)}
              onCardClick={setDetalhe}
            />
          </div>
        )}
      </div>

      {/* Painel — mobile (abaixo do calendário) */}
      {selectedDay && (
        <div className="lg:hidden bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <PainelDia
            dia={selectedDay}
            lancamentos={diaSelecionadoLancamentos}
            ehHoje={diaSelecionadoEhHoje}
            hoje={hoje}
            onAdicionar={() => abrirModalParaDia(selectedDay)}
            onCardClick={setDetalhe}
          />
        </div>
      )}

      {/* Modal de cadastro */}
      {modal.aberto && (
        <ModalCadastroConta
          dia={modal.dia}
          currentMonth={currentMonth}
          onClose={fecharModal}
          onSalvo={handleContaSalva}
        />
      )}

      {/* Modal de detalhe do lançamento */}
      {detalhe && (
        <ModalDetalheLancamento
          lancamento={detalhe}
          onClose={() => setDetalhe(null)}
          onAtualizado={handleLancamentoAtualizado}
          onExcluido={handleLancamentoExcluido}
        />
      )}

    </div>
  )
}
