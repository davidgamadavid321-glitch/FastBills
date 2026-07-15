import { useState, useEffect, useMemo } from 'react'
import { Loader2, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { formatarMoeda as formatarValor } from '../lib/utils'

// ── Constantes ───────────────────────────────────────────────

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// ── Detalhe expandido do mês ─────────────────────────────────

function DetalheMes({ lancamentos }) {
  const porCentro = useMemo(() => {
    const map = new Map()
    lancamentos.forEach(l => {
      const nome = l.contas?.centros_custo?.nome ?? 'Sem imóvel'
      map.set(nome, (map.get(nome) ?? 0) + (l.valor ?? 0))
    })
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [lancamentos])

  const porTitular = useMemo(() => {
    const map = new Map()
    lancamentos.forEach(l => {
      const t = l.contas?.titulares
      const nome = t?.nome ?? 'Sem titular'
      const prev = map.get(nome) ?? { total: 0, cor: t?.cor ?? null }
      map.set(nome, { total: prev.total + (l.valor ?? 0), cor: prev.cor })
    })
    return [...map.entries()]
      .map(([nome, { total, cor }]) => ({ nome, total, cor }))
      .sort((a, b) => b.total - a.total)
  }, [lancamentos])

  const contasOrdenadas = useMemo(
    () => [...lancamentos].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)),
    [lancamentos]
  )

  const secoes = [
    {
      titulo: 'Por imóvel',
      itens: porCentro.map(([nome, total]) => ({ nome, total })),
    },
    {
      titulo: 'Por titular',
      itens: porTitular.map(({ nome, total, cor }) => ({ nome, total, cor })),
    },
    {
      titulo: 'Contas pagas',
      itens: contasOrdenadas.map(l => ({ key: l.id, nome: l.contas?.nome ?? '—', total: l.valor })),
    },
  ]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Detalhamento
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {lancamentos.length} {lancamentos.length === 1 ? 'pagamento registrado' : 'pagamentos registrados'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {secoes.map(secao => (
          <div key={secao.titulo} className="min-w-0">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {secao.titulo}
            </p>
            <div className="space-y-2">
              {secao.itens.map(({ key, nome, total, cor }) => (
                <div key={key ?? `${secao.titulo}-${nome}`} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {cor && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: cor }}
                      />
                    )}
                    <p className="truncate text-xs font-medium text-slate-700">{nome}</p>
                  </div>
                  <p className="shrink-0 text-xs font-bold tabular-nums text-slate-950">{formatarValor(total)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────

export default function Resumo() {
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const anoHoje    = new Date().getFullYear()
  const mesHojeIdx = new Date().getMonth()

  const [ano,          setAno]          = useState(anoHoje)
  const [lancamentos,  setLancamentos]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState('')
  const [mesExpandido, setMesExpandido] = useState(null)

  const anos = useMemo(
    () => Array.from({ length: anoHoje - 2024 + 2 }, (_, i) => 2024 + i),
    [anoHoje]
  )

  useEffect(() => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    setLoading(true)
    setErroCarregamento('')
    setMesExpandido(null)
    supabase
      .from('lancamentos')
      .select(`
        *,
        contas:contas!lancamentos_workspace_conta_fkey(nome, centro_id, titular_id,
          centros_custo:centros_custo!contas_workspace_centro_fkey(nome),
          titulares:titulares!contas_workspace_titular_fkey(nome, cor))
      `)
      .eq('status', 'pago')
      .eq('workspace_id', workspaceId)
      .gte('vencimento', `${ano}-01-01`)
      .lte('vencimento', `${ano}-12-31`)
      .then(({ data, error }) => {
        if (error) {
          if (import.meta.env.DEV) console.error('Erro ao carregar resumo:', error)
          setErroCarregamento('Não foi possível carregar o resumo. Tente novamente.')
          setLancamentos([])
          setLoading(false)
          return
        }
        setLancamentos(data ?? [])
        setLoading(false)
      })
  }, [ano, workspaceId, loadingWorkspace, erroWorkspace])

  // ── Dados derivados ──

  const porMes = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => {
      const doMes = lancamentos.filter(
        l => parseInt(l.vencimento.split('-')[1], 10) - 1 === i
      )
      return {
        mes: i,
        total: doMes.reduce((s, l) => s + (l.valor ?? 0), 0),
        lancamentos: doMes,
      }
    }),
    [lancamentos]
  )

  const mesAtualIdx = anoHoje === ano ? mesHojeIdx : -1

  const mesesComDados = useMemo(
    () => porMes.filter(m => m.total > 0),
    [porMes]
  )

  const totalAnual = useMemo(
    () => mesesComDados.reduce((s, m) => s + m.total, 0),
    [mesesComDados]
  )

  const mediaMensal = mesesComDados.length > 0 ? totalAnual / mesesComDados.length : 0

  const idxMaisCaro = useMemo(() => {
    if (mesesComDados.length < 2) return -1
    return mesesComDados.reduce((mx, m) => (m.total > mx.total ? m : mx)).mes
  }, [mesesComDados])

  const idxMaisBarato = useMemo(() => {
    if (mesesComDados.length < 2) return -1
    return mesesComDados.reduce((mn, m) => (m.total < mn.total ? m : mn)).mes
  }, [mesesComDados])

  const melhorMes = idxMaisBarato >= 0 ? porMes[idxMaisBarato] : null
  const maiorMes = idxMaisCaro >= 0 ? porMes[idxMaisCaro] : null
  const mesesComPagamentoLabel = `${mesesComDados.length} ${mesesComDados.length === 1 ? 'mês com pagamento' : 'meses com pagamento'}`

  function toggleMes(i) {
    setMesExpandido(v => (v === i ? null : i))
  }

  // ── Render ──

  return (
    <div className="space-y-5">

      {/* Header com seletor de ano */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Resumo financeiro</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Fechamento financeiro</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? 'Carregando pagamentos...'
              : `Consolidação dos pagamentos registrados em ${ano}.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right shadow-sm shadow-slate-200/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ano</p>
            <div className="relative">
              <select
                value={ano}
                onChange={e => setAno(parseInt(e.target.value, 10))}
                className="appearance-none cursor-pointer bg-transparent pl-0 pr-5 text-sm font-bold text-slate-950 tabular-nums focus:outline-none"
              >
                {anos.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {erroWorkspace ? (
        <p className="text-sm text-red-500">{erroWorkspace}</p>
      ) : loadingWorkspace || loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={20} className="animate-spin text-slate-300" />
        </div>
      ) : erroCarregamento ? (
        <p className="text-sm text-red-500">{erroCarregamento}</p>
      ) : (
        <>

          {/* ── Fechamento executivo ── */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Fechamento de {ano}
                  </p>
                  <p className="mt-3 text-sm font-medium text-slate-500">Total pago no ano</p>
                  <p className="mt-2 text-3xl font-black leading-none text-slate-950 tabular-nums sm:text-5xl">
                    {formatarValor(totalAnual)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[420px]">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Registros</p>
                    <p className="mt-1 text-lg font-black text-slate-950 tabular-nums">{lancamentos.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Média</p>
                    <p className="mt-1 text-sm font-black text-slate-950 tabular-nums">{formatarValor(mediaMensal)}</p>
                  </div>
                  <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:col-span-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Período</p>
                    <p className="mt-1 text-sm font-bold text-slate-950">{mesesComPagamentoLabel}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="px-4 py-3 sm:px-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Maior mês</p>
                <p className="mt-1 text-sm font-bold text-slate-950">
                  {maiorMes ? NOMES_MESES[maiorMes.mes] : 'Sem referência'}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500 tabular-nums">
                  {maiorMes ? formatarValor(maiorMes.total) : '—'}
                </p>
              </div>
              <div className="px-4 py-3 sm:px-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Menor mês</p>
                <p className="mt-1 text-sm font-bold text-slate-950">
                  {melhorMes ? NOMES_MESES[melhorMes.mes] : 'Sem referência'}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500 tabular-nums">
                  {melhorMes ? formatarValor(melhorMes.total) : '—'}
                </p>
              </div>
              <div className="px-4 py-3 sm:px-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pagamentos</p>
                <p className="mt-1 text-sm font-bold text-slate-950">
                  {lancamentos.length} {lancamentos.length === 1 ? 'lançamento pago' : 'lançamentos pagos'}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">Base anual consolidada</p>
              </div>
            </div>
          </section>

          {/* ── Leitura rápida ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Leitura rápida</p>
                <h2 className="mt-1 text-base font-bold text-slate-950">Destaques do ano</h2>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {[
                ['Mês com maior pagamento', maiorMes ? `${NOMES_MESES[maiorMes.mes]} — ${formatarValor(maiorMes.total)}` : 'Sem referência'],
                ['Mês com menor pagamento', melhorMes ? `${NOMES_MESES[melhorMes.mes]} — ${formatarValor(melhorMes.total)}` : 'Sem referência'],
                ['Média mensal paga', formatarValor(mediaMensal)],
                ['Total de contas pagas', `${lancamentos.length} ${lancamentos.length === 1 ? 'pagamento' : 'pagamentos'}`],
              ].map(([label, valor]) => (
                <div key={label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-slate-600">{label}</p>
                  <p className="text-sm font-bold text-slate-950 tabular-nums">{valor}</p>
                </div>
              ))}
            </div>
          </section>

          {lancamentos.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center shadow-sm shadow-slate-200/60">
              <p className="text-sm font-semibold text-slate-950">Nenhum pagamento registrado em {ano}.</p>
              <p className="mt-1 text-xs text-slate-500">
                Quando houver lançamentos pagos, o resumo anual será preenchido automaticamente.
              </p>
            </div>
          )}

          {/* ── Movimento mensal ── */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Movimento mensal</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">Linha de pagamentos</h2>
            </div>
            <div className="divide-y divide-slate-100">
            {porMes.map((m, i) => {
              const isFuturo  = anoHoje === ano && i > mesHojeIdx
              const isAtual   = i === mesAtualIdx
              const semDados  = m.total === 0
              const expandido = mesExpandido === i

              const variacaoPct = (i > 0 && !semDados && porMes[i - 1].total > 0)
                ? ((m.total - porMes[i - 1].total) / porMes[i - 1].total) * 100
                : null

              const rowBg = isAtual
                ? 'bg-slate-50'
                : expandido
                ? 'bg-slate-50/80'
                : 'bg-white hover:bg-slate-50'

              return (
                <div key={i} className={isFuturo ? 'opacity-50' : ''}>

                  <div
                    className={`transition-colors ${rowBg} ${!semDados ? 'cursor-pointer' : 'cursor-default'}`}
                    onClick={() => !semDados && toggleMes(i)}
                  >
                    <div className="grid grid-cols-1 gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_160px_110px] sm:items-center sm:px-5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`text-sm font-bold ${isAtual ? 'text-slate-950' : 'text-slate-800'}`}>
                            {NOMES_MESES[i]}
                          </p>
                          {isAtual && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                              atual
                            </span>
                          )}
                          {!isAtual && i === idxMaisCaro && (
                            <span className="rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                              maior
                            </span>
                          )}
                          {!isAtual && i === idxMaisBarato && (
                            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                              menor
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          {m.lancamentos.length} {m.lancamentos.length === 1 ? 'pagamento registrado' : 'pagamentos registrados'}
                        </p>
                      </div>

                      <p className={`text-lg font-black tabular-nums sm:text-right ${
                        semDados ? 'text-slate-300' : 'text-slate-950'
                      }`}>
                        {semDados ? '—' : formatarValor(m.total)}
                      </p>

                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className={`text-xs font-semibold ${
                          variacaoPct === null
                            ? 'text-slate-300'
                            : variacaoPct > 0
                            ? 'text-red-600'
                            : 'text-emerald-600'
                        }`}>
                          {variacaoPct === null ? 'Sem variação' : `${variacaoPct > 0 ? '+' : ''}${variacaoPct.toFixed(1)}%`}
                        </span>
                        {!semDados && (
                          <ChevronDown
                            size={15}
                            className={`text-slate-400 transition-transform ${expandido ? 'rotate-180' : ''}`}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {expandido && !semDados && (
                    <div className="bg-slate-50 px-3 py-3 sm:px-5 sm:py-4">
                      <DetalheMes lancamentos={m.lancamentos} />
                    </div>
                  )}

                </div>
              )
            })}
            </div>
            <div className="flex flex-col gap-1 rounded-b-2xl bg-slate-950 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm font-bold text-white">Total consolidado de {ano}</p>
              <p className="text-lg font-black text-white tabular-nums">{formatarValor(totalAnual)}</p>
            </div>
          </section>

        </>
      )}

    </div>
  )
}
