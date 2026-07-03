import { useState, useRef } from 'react'
import { X, Upload, FileText, CheckCircle, Loader2, Tag, Trash2, RefreshCw } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { formatarMoeda as formatarValor, localISODate } from '../lib/utils'

// ── Utilitários ──────────────────────────────────────────────

function formatarVencimento(iso = '') {
  const [y, m, d] = iso.split('-')
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ]
  return `Dia ${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1]} ${y}`
}

function statusEfetivo(vencimento, status) {
  if (status === 'pago') return 'pago'
  if (status === 'vencido') return 'vencido'
  if (vencimento === localISODate(new Date())) return 'hoje'
  return 'pendente'
}

// ── Mapas de estilo ──────────────────────────────────────────

const STATUS_BADGE = {
  pago:     'bg-green-100 text-green-700',
  vencido:  'bg-red-100 text-red-700',
  hoje:     'bg-amber-100 text-amber-800',
  pendente: 'bg-slate-100 text-slate-600',
}

const STATUS_LABEL = {
  pago:     'Pago',
  vencido:  'Vencido',
  hoje:     'Vence hoje',
  pendente: 'Pendente',
}

const RECORRENCIA_LABEL = {
  uma_vez: 'Uma vez',
  mensal:  'Mensal',
  anual:   'Anual',
}

const TAMANHO_MAXIMO_PDF = 10 * 1024 * 1024

// ── Helpers de componente ────────────────────────────────────

function titularDoLancamento(lancamento) {
  const ctAtivo = lancamento.contas?.contas_titulares?.find(ct => ct.fim === null)
  return ctAtivo?.titulares ?? lancamento.contas?.titulares ?? null
}

function IconeLucide({ nome, ...props }) {
  const Icon = (nome && LucideIcons[nome]) ? LucideIcons[nome] : Tag
  return <Icon {...props} />
}

function InfoLinha({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-xs font-semibold text-slate-400 shrink-0 w-28">{label}</span>
      <div className="flex items-center justify-end gap-1.5 min-w-0">{children}</div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────

export default function ModalDetalheLancamento({ lancamento: inicial, onClose, onAtualizado, onExcluido }) {
  const { workspaceId } = useWorkspace()
  const [lancamento, setLancamento] = useState(inicial)
  const [confirmando, setConfirmando] = useState(false)
  const [marcandoPago, setMarcandoPago] = useState(false)
  const [uploadando, setUploadando] = useState(false)
  const [abrindoPDF, setAbrindoPDF] = useState(false)
  const [erro, setErro] = useState('')
  const [etapaExclusao, setEtapaExclusao] = useState(null) // null | 'confirmar' | 'escopo'
  const [excluindo, setExcluindo] = useState(false)

  const [trocandoTitular, setTrocandoTitular] = useState(false)
  const [titularesDisponiveis, setTitularesDisponiveis] = useState([])
  const [loadingTitulares, setLoadingTitulares] = useState(false)
  const [novoTitularId, setNovoTitularId] = useState('')
  const [salvandoTitular, setSalvandoTitular] = useState(false)

  const overlayRef = useRef(null)
  const inputPDFRef = useRef(null)

  const s = statusEfetivo(lancamento.vencimento, lancamento.status)
  const titular = titularDoLancamento(lancamento)
  const cor = titular?.cor

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  // ── Trocar titular ──

  async function handleAbrirTroca() {
    setLoadingTitulares(true)
    const { data } = await supabase
      .from('titulares')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('nome')
    setTitularesDisponiveis(data ?? [])
    const ctAtivo = lancamento.contas?.contas_titulares?.find(ct => ct.fim === null)
    setNovoTitularId(ctAtivo?.titular_id ?? lancamento.contas?.titular_id ?? '')
    setLoadingTitulares(false)
    setTrocandoTitular(true)
  }

  async function handleConfirmarTroca() {
    const ctAtivo = lancamento.contas?.contas_titulares?.find(ct => ct.fim === null)
    const titularAtualId = ctAtivo?.titular_id ?? lancamento.contas?.titular_id ?? null
    if (novoTitularId === titularAtualId) { setTrocandoTitular(false); return }

    setSalvandoTitular(true)
    setErro('')
    const hoje = localISODate(new Date())

    const { error: erroUpdate } = await supabase
      .from('contas')
      .update({ titular_id: novoTitularId })
      .eq('id', lancamento.conta_id)
      .eq('workspace_id', workspaceId)

    if (erroUpdate) {
      if (import.meta.env.DEV) console.error('Erro ao trocar titular:', erroUpdate)
      setErro('Não foi possível trocar o titular. Tente novamente.')
      setSalvandoTitular(false)
      return
    }

    if (titularAtualId) {
      await supabase
        .from('contas_titulares')
        .update({ fim: hoje })
        .eq('conta_id', lancamento.conta_id)
        .eq('workspace_id', workspaceId)
        .is('fim', null)
    }

    await supabase.from('contas_titulares').insert({
      conta_id:   lancamento.conta_id,
      titular_id: novoTitularId,
      inicio:     hoje,
      fim:        null,
      workspace_id: workspaceId,
    })

    const novoTitular = titularesDisponiveis.find(t => t.id === novoTitularId)
    const novoRegistroCT = {
      titular_id: novoTitularId,
      fim: null,
      titulares: { nome: novoTitular?.nome ?? '', cor: novoTitular?.cor ?? null },
    }
    const lancamentoAtualizado = {
      ...lancamento,
      contas: {
        ...lancamento.contas,
        titular_id: novoTitularId,
        titulares: { nome: novoTitular?.nome ?? '', cor: novoTitular?.cor ?? null },
        contas_titulares: [
          ...(lancamento.contas?.contas_titulares?.map(ct =>
            ct.fim === null ? { ...ct, fim: hoje } : ct
          ) ?? []),
          novoRegistroCT,
        ],
      },
    }

    setLancamento(lancamentoAtualizado)
    onAtualizado(lancamentoAtualizado)
    setSalvandoTitular(false)
    setTrocandoTitular(false)
  }

  // ── Exclusão ──

  function handleIniciarExclusao() {
    setConfirmando(false)
    setErro('')
    setEtapaExclusao('confirmar')
  }

  async function excluirSoEste() {
    setExcluindo(true)
    const { error } = await supabase
      .from('lancamentos')
      .delete()
      .eq('id', lancamento.id)
      .eq('workspace_id', workspaceId)
    setExcluindo(false)
    if (error) {
      if (import.meta.env.DEV) console.error('Erro ao excluir lançamento:', error)
      setErro('Não foi possível excluir o lançamento. Tente novamente.')
      return
    }
    onExcluido?.(lancamento.id)
    onClose()
  }

  async function excluirTodosFuturos() {
    setExcluindo(true)
    const hoje = localISODate(new Date())
    const { error: e1 } = await supabase
      .from('lancamentos')
      .delete()
      .eq('conta_id', lancamento.conta_id)
      .eq('workspace_id', workspaceId)
      .gte('vencimento', hoje)
    const { error: e2 } = await supabase
      .from('lancamentos')
      .delete()
      .eq('id', lancamento.id)
      .eq('workspace_id', workspaceId)
    setExcluindo(false)
    if (e1 || e2) {
      if (import.meta.env.DEV) console.error('Erro ao excluir lançamentos:', e1 || e2)
      setErro('Não foi possível excluir o lançamento. Tente novamente.')
      return
    }
    onExcluido?.(lancamento.id)
    onClose()
  }

  const recorrenciaMultipla = ['mensal', 'anual'].includes(lancamento.contas?.recorrencia)

  // ── Upload de PDF ──

  async function handleUploadPDF(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setErro('')

    if (!workspaceId) {
      setErro('Espaço de trabalho não disponível. Tente novamente.')
      e.target.value = ''
      return
    }

    if (file.type !== 'application/pdf') {
      setErro('Selecione um arquivo PDF válido.')
      e.target.value = ''
      return
    }

    if (file.size > TAMANHO_MAXIMO_PDF) {
      setErro('O PDF deve ter no máximo 10 MB.')
      e.target.value = ''
      return
    }

    const centroId = lancamento.contas?.centro_id ?? 'sem-centro'
    const [ano, mes] = lancamento.vencimento.split('-')
    const caminho = `${workspaceId}/${centroId}/${ano}-${mes}/${lancamento.id}.pdf`

    setUploadando(true)

    const { error: erroUpload } = await supabase.storage
      .from('comprovantes')
      .upload(caminho, file, { upsert: true, contentType: 'application/pdf' })

    if (erroUpload) {
      if (import.meta.env.DEV) console.error('Erro ao enviar comprovante:', erroUpload)
      setErro('Não foi possível enviar o comprovante. Tente novamente.')
      setUploadando(false)
      e.target.value = ''
      return
    }

    const { error: erroUpdate } = await supabase
      .from('lancamentos')
      .update({ pdf_url: caminho })
      .eq('id', lancamento.id)
      .eq('workspace_id', workspaceId)

    setUploadando(false)
    e.target.value = ''

    if (!erroUpdate) {
      const atualizado = { ...lancamento, pdf_url: caminho }
      setLancamento(atualizado)
      onAtualizado(atualizado)
    } else {
      if (import.meta.env.DEV) console.error('Erro ao salvar comprovante:', erroUpdate)
      if (lancamento.pdf_url !== caminho) {
        await supabase.storage.from('comprovantes').remove([caminho])
      }
      setErro('O comprovante foi enviado, mas não foi possível salvar. Tente novamente.')
    }
  }

  // ── Ver PDF ──

  async function handleVerPDF() {
    setErro('')

    if (!workspaceId || !lancamento.pdf_url) {
      setErro('Comprovante não disponível.')
      return
    }

    if (!lancamento.pdf_url.startsWith(`${workspaceId}/`)) {
      setErro('Este comprovante usa um formato antigo e precisa ser migrado.')
      return
    }

    setAbrindoPDF(true)
    const { data, error } = await supabase.storage
      .from('comprovantes')
      .createSignedUrl(lancamento.pdf_url, 120)
    setAbrindoPDF(false)

    if (error || !data?.signedUrl) {
      if (import.meta.env.DEV) console.error('Erro ao abrir comprovante:', error)
      setErro('Não foi possível abrir o comprovante. Tente novamente.')
      return
    }

    window.open(data.signedUrl, '_blank')
  }

  // ── Confirmar pagamento ──

  async function handleConfirmarPagamento() {
    setMarcandoPago(true)
    setErro('')

    const { data: { user } } = await supabase.auth.getUser()
    const hoje = localISODate(new Date())
    const alteradoPor = user?.user_metadata?.full_name || user?.email || ''

    const { error } = await supabase
      .from('lancamentos')
      .update({
        status: 'pago',
        data_pagamento: hoje,
        alterado_por: alteradoPor,
        alterado_em: new Date().toISOString(),
      })
      .eq('id', lancamento.id)
      .eq('workspace_id', workspaceId)

    setMarcandoPago(false)

    if (error) {
      if (import.meta.env.DEV) console.error('Erro ao marcar lançamento como pago:', error)
      setErro('Não foi possível marcar este lançamento como pago. Tente novamente.')
      return
    }

    const atualizado = {
      ...lancamento,
      status: 'pago',
      data_pagamento: hoje,
      alterado_por: alteradoPor,
      alterado_em: new Date().toISOString(),
    }

    onAtualizado(atualizado)
    onClose()
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[80vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: cor ? `${cor}22` : '#f1f5f9' }}
            >
              <IconeLucide
                nome={lancamento.contas?.categorias?.icone}
                size={19}
                style={{ color: cor ?? '#64748b' }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: cor ?? '#64748b' }}>
                {titular?.nome ?? '—'}
              </p>
              <p className="text-base font-bold text-slate-900 leading-tight truncate">
                {lancamento.contas?.nome ?? '—'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors shrink-0 ml-2"
          >
            <X size={17} className="text-slate-400" />
          </button>
        </div>

        {/* Conteúdo scrollável */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">

          {/* Informações */}
          <div className="bg-slate-50 rounded-2xl px-4 py-1">
            {trocandoTitular ? (
              <div className="py-3 border-b border-slate-100 space-y-2.5">
                <p className="text-xs font-semibold text-slate-400">Titular</p>
                <select
                  value={novoTitularId}
                  onChange={e => setNovoTitularId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
                >
                  {titularesDisponiveis.map(t => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTrocandoTitular(false)}
                    disabled={salvandoTitular}
                    className="flex-1 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-white transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirmarTroca}
                    disabled={salvandoTitular || !novoTitularId}
                    className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {salvandoTitular && <Loader2 size={14} className="animate-spin" />}
                    {salvandoTitular ? 'Salvando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            ) : (
              <InfoLinha label="Titular">
                {cor && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cor }} />
                )}
                <span className="text-sm font-semibold truncate" style={{ color: cor ?? '#334155' }}>
                  {titular?.nome ?? '—'}
                </span>
                <button
                  onClick={handleAbrirTroca}
                  disabled={loadingTitulares}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-50 shrink-0 ml-1"
                  title="Trocar titular"
                >
                  {loadingTitulares
                    ? <Loader2 size={12} className="animate-spin" />
                    : <RefreshCw size={12} />
                  }
                </button>
              </InfoLinha>
            )}

            <InfoLinha label="Imóvel">
              <span className="text-sm text-slate-700 truncate">
                {lancamento.contas?.centros_custo?.nome ?? '—'}
              </span>
            </InfoLinha>

            <InfoLinha label="Categoria">
              <span className="text-sm text-slate-700">
                {lancamento.contas?.categorias?.nome ?? '—'}
              </span>
            </InfoLinha>

            <InfoLinha label="Vencimento">
              <span className="text-sm text-slate-700">
                {formatarVencimento(lancamento.vencimento)}
              </span>
            </InfoLinha>

            <InfoLinha label="Valor">
              <span className="text-sm font-bold text-slate-900">
                {formatarValor(lancamento.valor)}
              </span>
            </InfoLinha>

            <InfoLinha label="Recorrência">
              <span className="text-sm text-slate-700">
                {RECORRENCIA_LABEL[lancamento.contas?.recorrencia] ?? '—'}
              </span>
            </InfoLinha>

            <InfoLinha label="Status">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE[s]}`}>
                {STATUS_LABEL[s]}
              </span>
            </InfoLinha>

            {lancamento.data_pagamento && (
              <InfoLinha label="Pago em">
                <span className="text-sm text-slate-700">
                  {formatarVencimento(lancamento.data_pagamento)}
                </span>
              </InfoLinha>
            )}

            {lancamento.alterado_por && (
              <InfoLinha label="Atualizado por">
                <span className="text-sm text-slate-500 truncate">{lancamento.alterado_por}</span>
              </InfoLinha>
            )}
          </div>

          {/* Erro */}
          {erro && (
            <p className="text-red-500 text-xs px-1">{erro}</p>
          )}

          {/* Ações */}
          <div className="space-y-2">

            {/* PDF */}
            {lancamento.pdf_url ? (
              <div className="flex gap-2">
                <button
                  onClick={handleVerPDF}
                  disabled={abrindoPDF}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {abrindoPDF
                    ? <Loader2 size={15} className="animate-spin" />
                    : <FileText size={15} />
                  }
                  Ver PDF
                </button>
                <button
                  onClick={() => inputPDFRef.current?.click()}
                  disabled={uploadando}
                  title="Substituir PDF"
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {uploadando
                    ? <Loader2 size={15} className="animate-spin" />
                    : <Upload size={15} />
                  }
                </button>
              </div>
            ) : (
              <button
                onClick={() => inputPDFRef.current?.click()}
                disabled={uploadando}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors disabled:opacity-50"
              >
                {uploadando
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Upload size={15} />
                }
                {uploadando ? 'Enviando...' : 'Anexar PDF'}
              </button>
            )}

            {/* Input file oculto */}
            <input
              ref={inputPDFRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleUploadPDF}
            />

            {/* Marcar como pago */}
            {s !== 'pago' && (
              confirmando ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-900 text-center leading-snug">
                    Confirmar pagamento de{' '}
                    <span className="font-bold">{formatarValor(lancamento.valor)}</span>?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmando(false)}
                      disabled={marcandoPago}
                      className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-white transition-colors disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirmarPagamento}
                      disabled={marcandoPago}
                      className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {marcandoPago && <Loader2 size={14} className="animate-spin" />}
                      {marcandoPago ? 'Salvando...' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmando(true)}
                  className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle size={16} />
                  Marcar como pago
                </button>
              )
            )}


            {/* Excluir lançamento */}
            {etapaExclusao === null && (
              <button
                onClick={handleIniciarExclusao}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-red-500 hover:text-red-700 transition-colors"
              >
                <Trash2 size={15} />
                Excluir lançamento
              </button>
            )}

            {etapaExclusao === 'confirmar' && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-medium text-slate-900 text-center leading-snug">
                  Excluir este lançamento? Esta ação não pode ser desfeita.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEtapaExclusao(null)}
                    disabled={excluindo}
                    className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-white transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => recorrenciaMultipla ? setEtapaExclusao('escopo') : excluirSoEste()}
                    disabled={excluindo}
                    className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {excluindo && <Loader2 size={14} className="animate-spin" />}
                    Excluir
                  </button>
                </div>
              </div>
            )}

            {etapaExclusao === 'escopo' && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-medium text-slate-900 text-center leading-snug">
                  Excluir só este ou todos os futuros?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={excluirSoEste}
                    disabled={excluindo}
                    className="flex-1 py-2.5 border border-red-200 bg-white rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {excluindo && <Loader2 size={14} className="animate-spin" />}
                    Só este
                  </button>
                  <button
                    onClick={excluirTodosFuturos}
                    disabled={excluindo}
                    className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {excluindo && <Loader2 size={14} className="animate-spin" />}
                    Todos os futuros
                  </button>
                </div>
                <button
                  onClick={() => setEtapaExclusao('confirmar')}
                  disabled={excluindo}
                  className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                >
                  Voltar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
