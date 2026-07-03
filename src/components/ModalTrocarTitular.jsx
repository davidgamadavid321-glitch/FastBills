import { useState, useEffect, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { localISODate } from '../lib/utils'

export default function ModalTrocarTitular({ centro, titulares, onClose, onSalvo }) {
  const { workspaceId } = useWorkspace()
  const [contas, setContas]                           = useState([])
  const [loading, setLoading]                         = useState(true)
  const [selecao, setSelecao]                         = useState({})  // { conta_id: titular_id | '' }
  const [selecaoOriginal, setSelecaoOriginal]         = useState({})
  const [salvando, setSalvando]                       = useState(false)
  const [erro, setErro]                               = useState('')
  const overlayRef = useRef(null)

  useEffect(() => {
    if (!workspaceId) return

    supabase
      .from('contas')
      .select('id, nome, titular_id')
      .eq('centro_id', centro.id)
      .eq('workspace_id', workspaceId)
      .eq('status_contrato', 'ativo')
      .order('nome')
      .then(({ data }) => {
        const cs = data ?? []
        setContas(cs)
        const map = Object.fromEntries(cs.map(c => [c.id, c.titular_id ?? '']))
        setSelecao(map)
        setSelecaoOriginal(map)
        setLoading(false)
      })
  }, [centro.id, workspaceId])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  const contasAlteradas = contas.filter(c => selecao[c.id] !== selecaoOriginal[c.id])
  const temAlteracoes   = contasAlteradas.length > 0

  async function handleConfirmar() {
    setErro('')
    setSalvando(true)
    const hoje = localISODate(new Date())

    for (const conta of contasAlteradas) {
      const novoTitularId    = selecao[conta.id] || null
      const titularAnteriorId = selecaoOriginal[conta.id] || null

      // 1. Atualiza titular_id na conta
      const { error: erroConta } = await supabase
        .from('contas')
        .update({ titular_id: novoTitularId })
        .eq('id', conta.id)
        .eq('workspace_id', workspaceId)

      if (erroConta) {
        if (import.meta.env.DEV) console.error('Erro ao trocar titular:', erroConta)
        setErro('Não foi possível trocar o titular. Tente novamente.')
        setSalvando(false)
        return
      }

      // 2. Fecha o registro ativo em contas_titulares
      if (titularAnteriorId) {
        await supabase
          .from('contas_titulares')
          .update({ fim: hoje })
          .eq('conta_id', conta.id)
          .eq('workspace_id', workspaceId)
          .is('fim', null)
      }

      // 3. Cria novo registro em contas_titulares
      if (novoTitularId) {
        await supabase.from('contas_titulares').insert({
          conta_id:   conta.id,
          titular_id: novoTitularId,
          inicio:     hoje,
          fim:        null,
          workspace_id: workspaceId,
        })
      }
    }

    setSalvando(false)
    onSalvo()
  }

  // Retorna o objeto titular selecionado para um conta (para mostrar cor)
  function titularSelecionado(contaId) {
    return titulares.find(t => t.id === selecao[contaId]) ?? null
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">Trocar titular</h2>
            <p className="text-xs text-slate-400 mt-0.5">{centro.nome}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={17} className="text-slate-400" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-slate-300" />
            </div>
          ) : contas.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              Nenhuma conta ativa neste centro.
            </p>
          ) : (
            contas.map(conta => {
              const ts = titularSelecionado(conta.id)
              const alterada = selecao[conta.id] !== selecaoOriginal[conta.id]
              return (
                <div key={conta.id} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-700 truncate">{conta.nome}</p>
                    {alterada && (
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full shrink-0">
                        alterado
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ts && (
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: ts.cor }}
                      />
                    )}
                    <select
                      value={selecao[conta.id] ?? ''}
                      onChange={e => setSelecao(s => ({ ...s, [conta.id]: e.target.value }))}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
                    >
                      <option value="">Nenhum</option>
                      {titulares.map(t => (
                        <option key={t.id} value={t.id}>{t.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })
          )}

          {erro && <p className="text-red-500 text-xs">{erro}</p>}

          {!loading && contas.length > 0 && (
            <button
              onClick={handleConfirmar}
              disabled={!temAlteracoes || salvando}
              className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
            >
              {salvando && <Loader2 size={15} className="animate-spin" />}
              {salvando
                ? 'Salvando...'
                : temAlteracoes
                ? `Confirmar ${contasAlteradas.length} alteração${contasAlteradas.length !== 1 ? 'ões' : ''}`
                : 'Nenhuma alteração'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
