import { useState, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'

const TIPOS = [
  { valor: 'casa',        label: 'Casa' },
  { valor: 'apartamento', label: 'Apartamento' },
  { valor: 'comercial',   label: 'Comercial' },
  { valor: 'pessoal',     label: 'Pessoal' },
  { valor: 'outro',       label: 'Outro' },
]

const STATUS_OPCOES = [
  { valor: 'ativo',        label: 'Ativo' },
  { valor: 'configuracao', label: 'Em configuração' },
]

export default function ModalFormCentro({ centro, onClose, onSalvo }) {
  const isEdicao = !!centro
  const { workspaceId } = useWorkspace()
  const [form, setForm] = useState({
    nome:   centro?.nome   ?? '',
    tipo:   centro?.tipo   ?? 'casa',
    status: centro?.status ?? 'ativo',
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState('')
  const overlayRef = useRef(null)

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  async function handleSalvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setErro('')
    setSalvando(true)

    const payload = { nome: form.nome.trim(), tipo: form.tipo }
    if (isEdicao) payload.status = form.status

    const query = isEdicao
      ? supabase.from('centros_custo').update(payload).eq('id', centro.id).eq('workspace_id', workspaceId).select().single()
      : supabase.from('centros_custo').insert({ ...payload, status: 'ativo', workspace_id: workspaceId }).select().single()

    const { data, error } = await query
    setSalvando(false)

    if (error) { setErro('Erro ao salvar. Tente novamente.'); return }
    onSalvo(data)
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <h2 className="text-base font-bold text-slate-900">
            {isEdicao ? 'Editar centro de custo' : 'Novo centro de custo'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={17} className="text-slate-400" />
          </button>
        </div>

        {/* Formulário */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Nome</label>
            <input
              type="text"
              value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleSalvar()}
              placeholder="Ex: Apartamento Centro"
              maxLength={80}
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
            />
          </div>

          {/* Tipo */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Tipo</label>
            <div className="flex flex-wrap gap-2">
              {TIPOS.map(t => (
                <button
                  key={t.valor}
                  onClick={() => setForm(f => ({ ...f, tipo: t.valor }))}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                    form.tipo === t.valor
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status — só na edição */}
          {isEdicao && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Status</label>
              <div className="flex gap-2">
                {STATUS_OPCOES.map(s => (
                  <button
                    key={s.valor}
                    onClick={() => setForm(f => ({ ...f, status: s.valor }))}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                      form.status === s.valor
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {erro && <p className="text-red-500 text-xs">{erro}</p>}

          <button
            onClick={handleSalvar}
            disabled={!form.nome.trim() || salvando}
            className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
          >
            {salvando && <Loader2 size={15} className="animate-spin" />}
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
