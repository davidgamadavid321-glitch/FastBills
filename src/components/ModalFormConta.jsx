import { useState, useEffect, useRef } from 'react'
import { X, Plus, Loader2, Tag } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { localISODate } from '../lib/utils'
import ModalFormCentro from './ModalFormCentro'

const RECORRENCIA = [
  { valor: 'uma_vez', label: 'Uma vez' },
  { valor: 'mensal',  label: 'Mensal' },
  { valor: 'anual',   label: 'Anual' },
]
const RECORRENCIAS_VALIDAS = new Set(RECORRENCIA.map(op => op.valor))
const STATUS_CONTRATO_VALIDOS = new Set(['ativo', 'a_fazer'])

function registrarErroDesenvolvimento(contexto, error) {
  if (import.meta.env.DEV) console.error(contexto, error)
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function IconeLucide({ nome, ...props }) {
  const Icon = (nome && LucideIcons[nome]) ? LucideIcons[nome] : Tag
  return <Icon {...props} />
}

export default function ModalFormConta({
  conta,
  centroIdInicial = '',
  centrosCusto,
  titulares,
  categorias: catsProp,
  onClose,
  onSalvo,
}) {
  const isEdicao = !!conta
  const { workspaceId } = useWorkspace()
  const [categorias, setCategorias] = useState(catsProp)
  const [categoriaSelecionada, setCategoriaSelecionada] = useState(
    conta ? (catsProp.find(c => c.id === conta.categoria_id) ?? null) : null
  )
  const [criandoCategoria, setCriandoCategoria] = useState(false)
  const [nomeNovaCategoria, setNomeNovaCategoria] = useState('')
  const [salvandoCategoria, setSalvandoCategoria] = useState(false)

  const [form, setForm] = useState({
    nome:             conta?.nome             ?? '',
    centro_id:        conta?.centro_id        ?? centroIdInicial,
    titular_id:       (() => {
      const ctAtivo = conta?.contas_titulares?.find(ct => ct.fim === null)
      return ctAtivo?.titular_id ?? conta?.titular_id ?? ''
    })(),
    recorrencia:      conta?.recorrencia      ?? 'mensal',
    dia_vencimento:   conta?.dia_vencimento   ?? '',
    mes_vencimento:   conta?.mes_vencimento   ?? '',
    valor_referencia: conta?.valor_referencia ?? '',
    status_contrato:  conta?.status_contrato  ?? 'ativo',
  })

  const [centrosCustoState, setCentrosCustoState] = useState(centrosCusto)
  const [criandoImovel, setCriandoImovel] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const overlayRef = useRef(null)
  const novaCatInputRef = useRef(null)
  const salvandoCatRef = useRef(false)

  useEffect(() => {
    if (criandoCategoria) novaCatInputRef.current?.focus()
  }, [criandoCategoria])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  async function salvarNovaCategoria() {
    if (!nomeNovaCategoria.trim() || salvandoCatRef.current) return
    salvandoCatRef.current = true
    setSalvandoCategoria(true)

    const { data, error } = await supabase
      .from('categorias')
      .insert({ nome: nomeNovaCategoria.trim(), workspace_id: workspaceId })
      .select()
      .single()

    if (!error && data) {
      const nova = [...categorias, data].sort((a, b) => a.nome.localeCompare(b.nome))
      setCategorias(nova)
      setCategoriaSelecionada(data)
    }

    setCriandoCategoria(false)
    setNomeNovaCategoria('')
    setSalvandoCategoria(false)
    salvandoCatRef.current = false
  }

  function handleNovaCatKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); salvarNovaCategoria() }
    if (e.key === 'Escape') { setCriandoCategoria(false); setNomeNovaCategoria('') }
  }

  async function handleSalvar() {
    const nome = form.nome.trim()
    const dia = Number(form.dia_vencimento)
    const mesVencimento = form.recorrencia === 'anual'
      ? Number(form.mes_vencimento)
      : null
    const valorReferencia = form.valor_referencia === ''
      ? null
      : Number(form.valor_referencia)
    const centroIdFinal = form.centro_id || null

    if (!workspaceId)               { setErro('Workspace não disponível. Tente novamente.'); return }
    if (!nome)                      { setErro('Nome é obrigatório.'); return }
    if (!categoriaSelecionada)      { setErro('Selecione uma categoria.'); return }
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) { setErro('Dia inválido (1–31).'); return }
    if (!RECORRENCIAS_VALIDAS.has(form.recorrencia)) { setErro('Recorrência inválida.'); return }
    if (!STATUS_CONTRATO_VALIDOS.has(form.status_contrato)) { setErro('Status do contrato inválido.'); return }
    if (form.recorrencia === 'anual' && (!Number.isInteger(mesVencimento) || mesVencimento < 1 || mesVencimento > 12)) {
      setErro('Informe o mês de vencimento.')
      return
    }
    if (valorReferencia !== null && (!Number.isFinite(valorReferencia) || valorReferencia < 0)) {
      setErro('Valor de referência inválido.')
      return
    }

    setErro('')
    setSalvando(true)

    const hoje            = localISODate(new Date())
    const novoTitularId   = form.titular_id  || null
    const ctAtivo         = conta?.contas_titulares?.find(ct => ct.fim === null)
    const titularAnterior = ctAtivo?.titular_id ?? conta?.titular_id ?? null

    const payload = {
      nome,
      categoria_id:     categoriaSelecionada.id,
      centro_id:        centroIdFinal,
      titular_id:       novoTitularId,
      recorrencia:      form.recorrencia,
      dia_vencimento:   dia,
      mes_vencimento:   mesVencimento,
      valor_referencia: valorReferencia,
      status_contrato:  form.status_contrato,
      workspace_id:     workspaceId,
    }

    const select = `
      *,
      centros_custo:centros_custo!contas_workspace_centro_fkey(nome, tipo),
      categorias:categorias!contas_workspace_categoria_fkey(nome, icone),
      titulares:titulares!contas_workspace_titular_fkey(nome, cor),
      contas_titulares:contas_titulares!contas_titulares_workspace_conta_fkey(
        titular_id, inicio, fim,
        titulares:titulares!contas_titulares_workspace_titular_fkey(nome, cor)
      )
    `

    const query = isEdicao
      ? supabase.from('contas').update(payload).eq('id', conta.id).eq('workspace_id', workspaceId).select(select).single()
      : supabase.from('contas').insert(payload).select(select).single()

    try {
      const { data, error } = await query
      if (error) throw error

      const titularMudou = novoTitularId !== titularAnterior

      if (!isEdicao && novoTitularId) {
        const { error: erroPrimeiroHistorico } = await supabase.from('contas_titulares').insert({
          conta_id:   data.id,
          titular_id: novoTitularId,
          inicio:     hoje,
          fim:        null,
          workspace_id: workspaceId,
        })

        if (erroPrimeiroHistorico) throw erroPrimeiroHistorico
      } else if (isEdicao && titularMudou) {
        if (titularAnterior) {
          const { error: erroFecharHistorico } = await supabase
            .from('contas_titulares')
            .update({ fim: hoje })
            .eq('conta_id', conta.id)
            .eq('workspace_id', workspaceId)
            .is('fim', null)

          if (erroFecharHistorico) throw erroFecharHistorico
        }
        if (novoTitularId) {
          const { error: erroAbrirHistorico } = await supabase.from('contas_titulares').insert({
            conta_id:   conta.id,
            titular_id: novoTitularId,
            inicio:     hoje,
            fim:        null,
            workspace_id: workspaceId,
          })

          if (erroAbrirHistorico) throw erroAbrirHistorico
        }
      }

      const { data: atualizado, error: erroAtualizar } = await supabase
        .from('contas')
        .select(select)
        .eq('id', data.id)
        .eq('workspace_id', workspaceId)
        .single()

      if (erroAtualizar) throw erroAtualizar
      onSalvo(atualizado)
    } catch (error) {
      registrarErroDesenvolvimento('Erro ao salvar conta:', error)
      setErro('Não foi possível salvar a conta. Verifique os dados e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <h2 className="text-base font-bold text-slate-900">
            {isEdicao ? 'Editar conta' : 'Nova conta'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={17} className="text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Nome</label>
            <input
              type="text"
              value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Ex: Condomínio"
              maxLength={80}
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
            />
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Categoria</label>
            <div className="grid grid-cols-3 gap-2">
              {categorias.map(cat => {
                const ativa = categoriaSelecionada?.id === cat.id
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategoriaSelecionada(cat)}
                    className={`rounded-2xl p-3 flex flex-col items-center gap-2 border transition-colors ${
                      ativa
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <IconeLucide nome={cat.icone} size={18} className={ativa ? 'text-white' : 'text-slate-500'} />
                    <span className="text-[11px] font-bold text-center leading-tight line-clamp-2">{cat.nome}</span>
                  </button>
                )
              })}

              {criandoCategoria ? (
                <div className="rounded-2xl p-3 border border-slate-300 bg-slate-50 flex flex-col items-center gap-1.5 justify-center min-h-[76px]">
                  <input
                    ref={novaCatInputRef}
                    value={nomeNovaCategoria}
                    onChange={e => setNomeNovaCategoria(e.target.value)}
                    onKeyDown={handleNovaCatKey}
                    placeholder="Nome..."
                    maxLength={40}
                    disabled={salvandoCategoria}
                    className="w-full text-xs text-center bg-transparent outline-none text-slate-900 placeholder:text-slate-300"
                  />
                  <div className="flex gap-2">
                    <button
                      onMouseDown={e => { e.preventDefault(); salvarNovaCategoria() }}
                      className="text-[10px] text-slate-900 font-semibold"
                    >
                      Salvar
                    </button>
                    <button
                      onMouseDown={e => { e.preventDefault(); setCriandoCategoria(false); setNomeNovaCategoria('') }}
                      className="text-[10px] text-slate-400"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCriandoCategoria(true)}
                  className="rounded-2xl p-3 border-2 border-dashed border-slate-200 flex flex-col items-center gap-2 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors min-h-[76px] justify-center"
                >
                  <Plus size={18} />
                  <span className="text-[11px] font-bold">Nova</span>
                </button>
              )}
            </div>
          </div>

          {/* Centro de custo unificado */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-700">Vínculos opcionais</label>

            {/* Pessoais */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Pessoais</p>
              <div className="flex flex-wrap gap-2">
                {titulares.map(t => {
                  const ativo = form.titular_id === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setForm(f => ({ ...f, titular_id: ativo ? '' : t.id }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                        ativo
                          ? 'border-transparent text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                      style={ativo ? { backgroundColor: t.cor } : {}}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                      {t.nome}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Imóveis */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Imóveis</p>
              <div className="flex flex-wrap gap-2">
                {centrosCustoState.map(c => {
                  const ativo = form.centro_id === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => setForm(f => ({ ...f, centro_id: ativo ? '' : c.id }))}
                      className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                        ativo
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {c.nome}
                    </button>
                  )
                })}
                <button
                  onClick={() => setCriandoImovel(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full border-2 border-dashed border-slate-200 text-xs font-semibold text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Plus size={11} />
                  Novo
                </button>
              </div>
            </div>
          </div>

          {/* Recorrência */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Recorrência</label>
            <div className="flex gap-2">
              {RECORRENCIA.map(op => (
                <button
                  key={op.valor}
                  onClick={() => setForm(f => ({ ...f, recorrencia: op.valor }))}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    form.recorrencia === op.valor
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dia + Mês (anual) */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Dia de vencimento</label>
              <input
                type="number"
                min="1"
                max="31"
                value={form.dia_vencimento}
                onChange={e => setForm(f => ({ ...f, dia_vencimento: e.target.value }))}
                placeholder="Ex: 10"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
              />
            </div>
            {form.recorrencia === 'anual' && (
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Mês</label>
                <select
                  value={form.mes_vencimento}
                  onChange={e => setForm(f => ({ ...f, mes_vencimento: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition"
                >
                  <option value="">Selecionar...</option>
                  {MESES.map((nome, i) => (
                    <option key={i + 1} value={i + 1}>{nome}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Valor de referência */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              Valor de referência{' '}
              <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <div className="flex items-center border border-slate-200 rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-slate-900 bg-white transition">
              <span className="text-sm text-slate-400 mr-2 shrink-0">R$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.valor_referencia}
                onChange={e => setForm(f => ({ ...f, valor_referencia: e.target.value }))}
                placeholder="0,00"
                className="flex-1 text-sm text-slate-900 bg-transparent outline-none"
              />
            </div>
          </div>

          {/* Status do contrato */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Status do contrato</label>
            <div className="flex gap-2">
              {[
                { valor: 'ativo',   label: 'Ativo' },
                { valor: 'a_fazer', label: 'A fazer' },
              ].map(s => (
                <button
                  key={s.valor}
                  onClick={() => setForm(f => ({ ...f, status_contrato: s.valor }))}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    form.status_contrato === s.valor
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {erro && <p className="text-red-500 text-xs">{erro}</p>}

          <button
            onClick={handleSalvar}
            disabled={salvando}
            className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
          >
            {salvando && <Loader2 size={15} className="animate-spin" />}
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>

    {criandoImovel && (
      <ModalFormCentro
        centro={null}
        onClose={() => setCriandoImovel(false)}
        onSalvo={novoImovel => {
          setCentrosCustoState(prev => [...prev, novoImovel].sort((a, b) => a.nome.localeCompare(b.nome)))
          setForm(f => ({ ...f, centro_id: novoImovel.id }))
          setCriandoImovel(false)
        }}
      />
    )}
    </>
  )
}
