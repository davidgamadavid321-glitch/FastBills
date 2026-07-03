import { useState, useEffect, useMemo } from 'react'
import { Loader2, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react'
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">

      {/* Por imóvel */}
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
          Por imóvel
        </p>
        <div className="space-y-2">
          {porCentro.map(([nome, total]) => (
            <div key={nome} className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-700 truncate">{nome}</p>
              <p className="text-xs font-bold text-slate-900 shrink-0">{formatarValor(total)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Por titular */}
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
          Por titular
        </p>
        <div className="space-y-2">
          {porTitular.map(({ nome, total, cor }) => (
            <div key={nome} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                {cor && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: cor }}
                  />
                )}
                <p
                  className="text-xs font-semibold truncate"
                  style={{ color: cor ?? '#334155' }}
                >
                  {nome}
                </p>
              </div>
              <p className="text-xs font-bold text-slate-900 shrink-0">{formatarValor(total)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Contas pagas */}
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
          Contas pagas
        </p>
        <div className="space-y-2">
          {contasOrdenadas.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-700 truncate">{l.contas?.nome ?? '—'}</p>
              <p className="text-xs font-bold text-slate-900 shrink-0">{formatarValor(l.valor)}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Página principal ─────────────────────────────────────────

const COL = 'grid grid-cols-[1fr_140px_120px]'

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

  function toggleMes(i) {
    setMesExpandido(v => (v === i ? null : i))
  }

  // ── Render ──

  return (
    <div className="space-y-5">

      {/* Header com seletor de ano */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {loading
            ? 'Carregando...'
            : `${lancamentos.length} pagamento${lancamentos.length !== 1 ? 's' : ''} em ${ano}`}
        </p>
        <div className="relative">
          <select
            value={ano}
            onChange={e => setAno(parseInt(e.target.value, 10))}
            className="appearance-none cursor-pointer border border-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
          >
            {anos.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
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

          {/* ── Cards de resumo ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 font-medium mb-2">Total pago em {ano}</p>
              <p className="text-xl font-black text-slate-900 leading-none">
                {formatarValor(totalAnual)}
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <p className="text-xs text-red-600 font-medium mb-1.5">Mês mais caro</p>
              {idxMaisCaro >= 0 ? (
                <>
                  <p className="text-[11px] font-semibold text-red-600 mb-0.5">
                    {NOMES_MESES[idxMaisCaro]}
                  </p>
                  <p className="text-base font-black text-red-800 leading-none">
                    {formatarValor(porMes[idxMaisCaro].total)}
                  </p>
                </>
              ) : (
                <p className="text-base font-bold text-red-300">—</p>
              )}
            </div>

            <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
              <p className="text-xs text-green-600 font-medium mb-1.5">Mês mais barato</p>
              {idxMaisBarato >= 0 ? (
                <>
                  <p className="text-[11px] font-semibold text-green-600 mb-0.5">
                    {NOMES_MESES[idxMaisBarato]}
                  </p>
                  <p className="text-base font-black text-green-800 leading-none">
                    {formatarValor(porMes[idxMaisBarato].total)}
                  </p>
                </>
              ) : (
                <p className="text-base font-bold text-green-300">—</p>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 font-medium mb-2">Média mensal</p>
              <p className="text-xl font-black text-slate-900 leading-none">
                {formatarValor(mediaMensal)}
              </p>
            </div>

          </div>

          {/* ── Tabela comparativa ── */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

            {/* Cabeçalho */}
            <div className={`${COL} px-4 py-2.5 border-b border-slate-100`}>
              <p className="text-xs font-semibold text-slate-400">Mês</p>
              <p className="text-xs font-semibold text-slate-400 text-right">Total pago</p>
              <p className="text-xs font-semibold text-slate-400 text-right">Variação</p>
            </div>

            {porMes.map((m, i) => {
              const isFuturo  = anoHoje === ano && i > mesHojeIdx
              const isAtual   = i === mesAtualIdx
              const semDados  = m.total === 0
              const expandido = mesExpandido === i

              const variacaoPct = (i > 0 && !semDados && porMes[i - 1].total > 0)
                ? ((m.total - porMes[i - 1].total) / porMes[i - 1].total) * 100
                : null

              const rowBg = isAtual
                ? 'bg-blue-50 hover:bg-blue-100'
                : expandido
                ? 'bg-slate-50 hover:bg-slate-100'
                : 'hover:bg-slate-50'

              return (
                <div key={i} className={isFuturo ? 'opacity-50' : ''}>

                  {/* Linha da tabela */}
                  <div
                    className={`${COL} px-4 py-3 border-b border-slate-50 transition-colors ${rowBg} ${!semDados ? 'cursor-pointer' : 'cursor-default'}`}
                    onClick={() => !semDados && toggleMes(i)}
                  >
                    {/* Mês + badges */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-sm font-semibold ${isAtual ? 'text-blue-700' : 'text-slate-800'}`}>
                        {NOMES_MESES[i]}
                      </span>
                      {isAtual && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                          atual
                        </span>
                      )}
                      {!isAtual && i === idxMaisCaro && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">
                          maior
                        </span>
                      )}
                      {!isAtual && i === idxMaisBarato && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">
                          menor
                        </span>
                      )}
                    </div>

                    {/* Total */}
                    <p className={`text-sm font-bold text-right ${
                      semDados
                        ? 'text-slate-300'
                        : isAtual
                        ? 'text-blue-800'
                        : 'text-slate-900'
                    }`}>
                      {semDados ? '—' : formatarValor(m.total)}
                    </p>

                    {/* Variação */}
                    <div className="flex items-center justify-end gap-1">
                      {variacaoPct !== null ? (
                        <>
                          {variacaoPct > 0 ? (
                            <TrendingUp size={13} className="text-red-500 shrink-0" />
                          ) : (
                            <TrendingDown size={13} className="text-green-500 shrink-0" />
                          )}
                          <span className={`text-xs font-semibold ${
                            variacaoPct > 0 ? 'text-red-600' : 'text-green-600'
                          }`}>
                            {variacaoPct > 0 ? '+' : ''}{variacaoPct.toFixed(1)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </div>
                  </div>

                  {/* Detalhe expandido */}
                  {expandido && !semDados && (
                    <div className="px-4 py-4 border-b border-slate-100 bg-slate-50">
                      <DetalheMes lancamentos={m.lancamentos} />
                    </div>
                  )}

                </div>
              )
            })}

            {/* Linha de total anual */}
            <div className={`${COL} px-4 py-3.5 bg-slate-900 rounded-b-2xl`}>
              <p className="text-sm font-bold text-white">Total {ano}</p>
              <p className="text-sm font-black text-white text-right">{formatarValor(totalAnual)}</p>
              <div />
            </div>

          </div>

        </>
      )}

    </div>
  )
}
