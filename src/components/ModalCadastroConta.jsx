import { useState, useEffect, useRef } from 'react'
import { X, ChevronLeft, Plus, Loader2, Tag } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { localISODate, calcularStatus } from '../lib/utils'
import ModalFormCentro from './ModalFormCentro'

const ICONE_KEYS = ['Droplets', 'Zap', 'Flame', 'Wifi', 'Shield', 'Home', 'CreditCard', 'Building2', 'Car', 'Smartphone', 'Package']

const NOMES_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const RECORRENCIA = [
  { valor: 'uma_vez', label: 'Uma vez' },
  { valor: 'mensal',  label: 'Mensal' },
  { valor: 'anual',   label: 'Anual' },
]
const RECORRENCIAS_VALIDAS = new Set(RECORRENCIA.map(op => op.valor))

function registrarErroDesenvolvimento(contexto, error) {
  if (import.meta.env.DEV) console.error(contexto, error)
}

function IconeLucide({ nome, ...props }) {
  const Icon = (nome && LucideIcons[nome]) ? LucideIcons[nome] : Tag
  return <Icon {...props} />
}

// ── Componente ───────────────────────────────────────────────

export default function ModalCadastroConta({ dia, currentMonth, onClose, onSalvo }) {
  const { workspaceId } = useWorkspace()
  const [etapa, setEtapa] = useState(1)
  const [categorias, setCategorias] = useState([])
  const [titulares, setTitulares] = useState([])
  const [centrosCusto, setCentrosCusto] = useState([])

  const [categoriaSelecionada, setCategoriaSelecionada] = useState(null)
  const [criandoCategoria,    setCriandoCategoria]    = useState(false)
  const [nomeNovaCategoria,   setNomeNovaCategoria]   = useState('')
  const [iconeNovaCategoria,  setIconeNovaCategoria]  = useState(ICONE_KEYS[0])
  const [salvandoCategoria,   setSalvandoCategoria]   = useState(false)

  const [form, setForm] = useState({
    centro_id: '',
    titular_id: '',
    valor: '',
    recorrencia: 'uma_vez',
  })

  const [criandoImovel, setCriandoImovel] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const overlayRef = useRef(null)
  const novaCatInputRef = useRef(null)
  const salvandoCatRef = useRef(false)

  const dataClicada = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dia)
  const dataFormatada = `${dia} de ${NOMES_MESES[currentMonth.getMonth()]} de ${currentMonth.getFullYear()}`

  // Busca dados ao abrir
  useEffect(() => {
    Promise.all([
      supabase.from('categorias').select('*').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('titulares').select('*').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('centros_custo').select('*').eq('workspace_id', workspaceId).eq('status', 'ativo').order('nome'),
    ]).then(([{ data: cats }, { data: tits }, { data: centros }]) => {
      setCategorias(cats ?? [])
      setTitulares(tits ?? [])
      setCentrosCusto(centros ?? [])
    })
  }, [workspaceId])

  // Foca input ao ativar criação inline
  useEffect(() => {
    if (criandoCategoria) novaCatInputRef.current?.focus()
  }, [criandoCategoria])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  // Cria nova categoria inline e seleciona automaticamente
  async function salvarNovaCategoria() {
    if (!nomeNovaCategoria.trim() || salvandoCatRef.current) return
    salvandoCatRef.current = true
    setSalvandoCategoria(true)
    setErro('')

    const { data, error } = await supabase
      .from('categorias')
      .insert({ nome: nomeNovaCategoria.trim(), icone: iconeNovaCategoria, workspace_id: workspaceId })
      .select()
      .single()

    if (!error && data) {
      setCategorias(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
      setCategoriaSelecionada(data)
    } else {
      registrarErroDesenvolvimento('Erro ao criar categoria:', error)
      setErro('Não foi possível criar a categoria. Tente novamente.')
    }

    setCriandoCategoria(false)
    setNomeNovaCategoria('')
    setIconeNovaCategoria(ICONE_KEYS[0])
    setSalvandoCategoria(false)
    salvandoCatRef.current = false
  }

  function handleNovaCatKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); salvarNovaCategoria() }
    if (e.key === 'Escape') { setCriandoCategoria(false); setNomeNovaCategoria('') }
  }

  function cancelarNovaCategoria() {
    setCriandoCategoria(false)
    setNomeNovaCategoria('')
    setIconeNovaCategoria(ICONE_KEYS[0])
  }

  // Monta lançamentos conforme recorrência, com status calculado por data
  function buildLancamentos(contaId, valor) {
    const base = dataClicada
    if (form.recorrencia === 'uma_vez') {
      const vencimento = localISODate(base)
      return [{ conta_id: contaId, valor, vencimento, status: calcularStatus(vencimento), workspace_id: workspaceId }]
    }
    if (form.recorrencia === 'mensal') {
      return Array.from({ length: 12 }, (_, i) => {
        const d = new Date(base.getFullYear(), base.getMonth() + i, dia)
        const vencimento = localISODate(d)
        return { conta_id: contaId, valor, vencimento, status: calcularStatus(vencimento), workspace_id: workspaceId }
      })
    }
    // anual: até 6 iterações, sempre inclui o ano atual, anos futuros só se data >= hoje
    const mesVenc = base.getMonth()
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const resultado = []
    let primeiroAdicionado = false
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear() + i, mesVenc, dia)
      d.setHours(0, 0, 0, 0)
      if (!primeiroAdicionado || d >= hoje) {
        const vencimento = localISODate(d)
        resultado.push({ conta_id: contaId, valor, vencimento, status: calcularStatus(vencimento), workspace_id: workspaceId })
        primeiroAdicionado = true
      }
    }
    return resultado
  }

  async function handleSalvar() {
    setErro('')
    const nome = categoriaSelecionada?.nome?.trim() ?? ''
    const valor = Number(form.valor)
    const diaVencimento = Number(dia)
    const centroIdFinal = form.centro_id || null
    const mesVencimento = form.recorrencia === 'anual'
      ? currentMonth.getMonth() + 1
      : null

    if (!workspaceId) { setErro('Espaço de trabalho não disponível. Tente novamente.'); return }
    if (!categoriaSelecionada?.id || !nome) { setErro('Selecione uma categoria válida.'); return }
    if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
      setErro('Dia de vencimento inválido.')
      return
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      setErro('Informe um valor maior que zero.')
      return
    }
    if (!RECORRENCIAS_VALIDAS.has(form.recorrencia)) {
      setErro('Selecione uma recorrência válida.')
      return
    }
    if (mesVencimento !== null && (mesVencimento < 1 || mesVencimento > 12)) {
      setErro('Mês de vencimento inválido.')
      return
    }

    setSalvando(true)

    try {
      const contaPayload = {
        nome,
        categoria_id: categoriaSelecionada.id,
        centro_id: centroIdFinal,
        titular_id: form.titular_id || null,
        recorrencia: form.recorrencia,
        dia_vencimento: diaVencimento,
        mes_vencimento: mesVencimento,
        valor_referencia: valor,
        status_contrato: 'ativo',
        workspace_id: workspaceId,
      }

      const { data: conta, error: erroConta } = await supabase
        .from('contas')
        .insert(contaPayload)
        .select()
        .single()

      if (erroConta) throw erroConta

      const lancamentosPayload = buildLancamentos(conta.id, valor)
      const selectLancamento = `
        *,
        contas:contas!lancamentos_workspace_conta_fkey(
          nome, recorrencia, categoria_id, centro_id, titular_id,
          categorias:categorias!contas_workspace_categoria_fkey(nome, icone),
          centros_custo:centros_custo!contas_workspace_centro_fkey(nome),
          titulares:titulares!contas_workspace_titular_fkey(nome, cor)
        )
      `

      try {
        const novosLancamentos = await Promise.all(lancamentosPayload.map(async (novoLancamento) => {
          const { data, error } = await supabase
            .from('lancamentos')
            .insert(novoLancamento)
            .select(selectLancamento)
            .single()

          if (!error) return data
          if (error.code !== '23505') throw error

          const { data: existente, error: erroBusca } = await supabase
            .from('lancamentos')
            .select(selectLancamento)
            .eq('workspace_id', workspaceId)
            .eq('conta_id', novoLancamento.conta_id)
            .eq('vencimento', novoLancamento.vencimento)
            .single()

          if (erroBusca) throw erroBusca
          return existente
        }))

        onSalvo(novosLancamentos)
      } catch (error) {
        registrarErroDesenvolvimento('Erro ao gerar lançamentos da conta criada:', error)
        setErro('A conta foi criada, mas não foi possível gerar os lançamentos. Abra a conta e revise os lançamentos.')
      }
    } catch (error) {
      registrarErroDesenvolvimento('Erro ao criar conta:', error)
      setErro('Não foi possível criar a conta. Confira os dados e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  const podeContinuar = !!categoriaSelecionada

  return (
    <>
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            {etapa === 2 && (
              <button
                onClick={() => setEtapa(1)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={17} className="text-slate-500" />
              </button>
            )}
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">Nova conta</h2>
              <p className="text-xs text-slate-400">{dataFormatada}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={17} className="text-slate-400" />
          </button>
        </div>

        {/* Indicador de etapas */}
        <div className="flex gap-2 px-5 mb-4 shrink-0">
          {['Categoria', 'Detalhes'].map((label, i) => (
            <div key={label} className="flex-1 space-y-1">
              <div
                className={`h-1 rounded-full transition-colors ${
                  i + 1 <= etapa ? 'bg-slate-900' : 'bg-slate-200'
                }`}
              />
              <span
                className={`text-[10px] font-semibold block ${
                  i + 1 <= etapa ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Conteúdo com scroll */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">

          {/* ── Etapa 1: Categoria ── */}
          {etapa === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {categorias.map(cat => {
                  const ativa = categoriaSelecionada?.id === cat.id
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategoriaSelecionada(cat)}
                      className={`rounded-2xl p-3 flex flex-col items-center gap-2 border transition-colors text-left ${
                        ativa
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <IconeLucide
                        nome={cat.icone}
                        size={20}
                        className={ativa ? 'text-white' : 'text-slate-500'}
                      />
                      <span className="text-xs font-bold text-center leading-tight line-clamp-2">
                        {cat.nome}
                      </span>
                    </button>
                  )
                })}

                {/* Card "+ Nova categoria" */}
                {criandoCategoria ? (
                  <div className="col-span-3 rounded-2xl p-3 border border-slate-300 bg-slate-50 flex flex-col gap-2.5">
                    <input
                      ref={novaCatInputRef}
                      value={nomeNovaCategoria}
                      onChange={e => setNomeNovaCategoria(e.target.value)}
                      onKeyDown={handleNovaCatKey}
                      placeholder="Nome da categoria"
                      maxLength={40}
                      disabled={salvandoCategoria}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
                    />
                    <div className="grid grid-cols-6 gap-1.5">
                      {ICONE_KEYS.map(key => {
                        const Ic = LucideIcons[key] ?? Tag
                        return (
                          <button
                            key={key}
                            type="button"
                            onMouseDown={e => { e.preventDefault(); setIconeNovaCategoria(key) }}
                            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                              iconeNovaCategoria === key
                                ? 'bg-slate-900 text-white'
                                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            <Ic size={14} />
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onMouseDown={e => { e.preventDefault(); cancelarNovaCategoria() }}
                        className="flex-1 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onMouseDown={e => { e.preventDefault(); salvarNovaCategoria() }}
                        disabled={salvandoCategoria}
                        className="flex-1 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {salvandoCategoria && <Loader2 size={12} className="animate-spin" />}
                        {salvandoCategoria ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setCriandoCategoria(true)}
                    className="rounded-2xl p-3 border-2 border-dashed border-slate-200 flex flex-col items-center gap-2 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors min-h-[80px] justify-center"
                  >
                    <Plus size={20} />
                    <span className="text-xs font-bold">Nova</span>
                  </button>
                )}
              </div>

              <button
                onClick={() => setEtapa(2)}
                disabled={!podeContinuar}
                className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                Continuar
              </button>
            </div>
          )}

          {/* ── Etapa 2: Detalhes ── */}
          {etapa === 2 && (
            <div className="space-y-5">

              {/* Categoria selecionada */}
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <IconeLucide
                    nome={categoriaSelecionada?.icone}
                    size={15}
                    className="text-slate-500 shrink-0"
                  />
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {categoriaSelecionada?.nome}
                  </span>
                </div>
                <button
                  onClick={() => setEtapa(1)}
                  className="text-xs text-slate-400 hover:text-slate-700 underline shrink-0 ml-2"
                >
                  Alterar
                </button>
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
                    {centrosCusto.map(c => {
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

              {/* Valor */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Valor</label>
                <div className="flex items-center border border-slate-200 rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-slate-900 bg-white transition">
                  <span className="text-sm text-slate-400 mr-2 shrink-0">R$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.valor}
                    onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                    placeholder="0,00"
                    className="flex-1 text-sm text-slate-900 bg-transparent outline-none"
                  />
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

              {/* Erro */}
              {erro && <p className="text-red-500 text-xs">{erro}</p>}

              {/* Salvar */}
              <button
                onClick={handleSalvar}
                disabled={salvando}
                className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
              >
                {salvando && <Loader2 size={15} className="animate-spin" />}
                {salvando ? 'Salvando...' : 'Salvar conta'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {criandoImovel && (
      <ModalFormCentro
        centro={null}
        onClose={() => setCriandoImovel(false)}
        onSalvo={novoImovel => {
          setCentrosCusto(prev => [...prev, novoImovel].sort((a, b) => a.nome.localeCompare(b.nome)))
          setForm(f => ({ ...f, centro_id: novoImovel.id }))
          setCriandoImovel(false)
        }}
      />
    )}
    </>
  )
}
