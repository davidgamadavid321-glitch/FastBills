import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, User, Zap, Plus, Loader2, Check, ChevronRight,
  Droplets, Flame, Wifi, Shield, Home, CreditCard, Car, Smartphone, Package,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import ModalFormCentro from '../components/ModalFormCentro'

const CORES = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#EF4444', '#F97316', '#06B6D4']

const ICONE_MAP = {
  Droplets, Zap, Flame, Wifi, Shield, Home, CreditCard, Building2, Car, Smartphone, Package,
}
const ICONE_KEYS = Object.keys(ICONE_MAP)

function IcoDinamico({ nome, ...props }) {
  const Comp = ICONE_MAP[nome] ?? Zap
  return <Comp {...props} />
}

function CardHeader({ color, Icon, titulo, count }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}20` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <h3 className="text-sm font-bold text-slate-900 flex-1">{titulo}</h3>
      {count > 0 && (
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {count}
        </span>
      )}
    </div>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)

  const [centros,  setCentros]  = useState([])
  const [titulares, setTitulares] = useState([])
  const [categorias, setCategorias] = useState([])

  const [modalCentro, setModalCentro] = useState(false)

  const [adicionandoTitular, setAdicionandoTitular] = useState(false)
  const [nomeTitular,        setNomeTitular]        = useState('')
  const [corTitular,         setCorTitular]         = useState(CORES[0])
  const [salvandoTitular,    setSalvandoTitular]    = useState(false)

  const [adicionandoCategoria, setAdicionandoCategoria] = useState(false)
  const [nomeCategoria,        setNomeCategoria]        = useState('')
  const [iconeCategoria,       setIconeCategoria]       = useState(ICONE_KEYS[0])
  const [salvandoCategoria,    setSalvandoCategoria]    = useState(false)

  useEffect(() => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    Promise.all([
      supabase.from('centros_custo').select('id, nome, tipo').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('titulares').select('id, nome, cor').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('categorias').select('id, nome, icone').eq('workspace_id', workspaceId).order('nome'),
    ]).then(([c, t, cat]) => {
      setCentros(c.data ?? [])
      setTitulares(t.data ?? [])
      setCategorias(cat.data ?? [])
      setLoading(false)
    })
  }, [workspaceId, loadingWorkspace, erroWorkspace])

  const podeComecar = centros.length > 0 || titulares.length > 0 || categorias.length > 0

  function handleCentroSalvo(data) {
    setCentros(prev => [...prev, data])
    setModalCentro(false)
  }

  async function handleAdicionarTitular() {
    if (!nomeTitular.trim()) return
    setSalvandoTitular(true)
    const { data, error } = await supabase
      .from('titulares')
      .insert({ nome: nomeTitular.trim(), cor: corTitular, workspace_id: workspaceId })
      .select()
      .single()
    setSalvandoTitular(false)
    if (error) return
    setTitulares(prev => [...prev, data])
    setNomeTitular('')
    setCorTitular(CORES[0])
    setAdicionandoTitular(false)
  }

  async function handleAdicionarCategoria() {
    if (!nomeCategoria.trim()) return
    setSalvandoCategoria(true)
    const { data, error } = await supabase
      .from('categorias')
      .insert({ nome: nomeCategoria.trim(), icone: iconeCategoria, workspace_id: workspaceId })
      .select()
      .single()
    setSalvandoCategoria(false)
    if (error) return
    setCategorias(prev => [...prev, data])
    setNomeCategoria('')
    setIconeCategoria(ICONE_KEYS[0])
    setAdicionandoCategoria(false)
  }

  if (erroWorkspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <p className="text-sm text-red-500 text-center">{erroWorkspace}</p>
      </div>
    )
  }

  if (loadingWorkspace || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={20} className="animate-spin text-slate-300" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 py-10">
      <div className="w-full max-w-3xl">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-slate-900">Bem-vindo ao sistema</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            Adicione ao menos um item em qualquer categoria para começar
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">

          {/* Imóveis */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <CardHeader color="#3B82F6" Icon={Building2} titulo="Imóveis" count={centros.length} />

            {centros.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {centros.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                    <p className="text-xs font-semibold text-slate-700 flex-1 truncate">{c.nome}</p>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setModalCentro(true)}
              className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
              <Plus size={14} />
              Adicionar imóvel
            </button>
          </div>

          {/* Titulares */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <CardHeader color="#8B5CF6" Icon={User} titulo="Titulares" count={titulares.length} />

            {titulares.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {titulares.map(t => (
                  <div key={t.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: t.cor ?? '#8B5CF6' }}
                    />
                    <p
                      className="text-xs font-semibold flex-1 truncate"
                      style={{ color: t.cor ?? '#334155' }}
                    >
                      {t.nome}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {adicionandoTitular ? (
              <div className="space-y-2.5 border border-slate-200 rounded-xl p-3">
                <input
                  type="text"
                  value={nomeTitular}
                  onChange={e => setNomeTitular(e.target.value)}
                  placeholder="Nome do titular"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleAdicionarTitular()}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {CORES.map(cor => (
                    <button
                      key={cor}
                      onClick={() => setCorTitular(cor)}
                      className="w-6 h-6 rounded-full shrink-0 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: cor,
                        outline: corTitular === cor ? `2px solid ${cor}` : 'none',
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAdicionandoTitular(false); setNomeTitular('') }}
                    className="flex-1 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleAdicionarTitular}
                    disabled={!nomeTitular.trim() || salvandoTitular}
                    className="flex-1 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {salvandoTitular
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Check size={12} />}
                    {salvandoTitular ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdicionandoTitular(true)}
                className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                <Plus size={14} />
                Adicionar titular
              </button>
            )}
          </div>

          {/* Categorias */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <CardHeader color="#F59E0B" Icon={Zap} titulo="Categorias" count={categorias.length} />

            {categorias.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {categorias.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                    <IcoDinamico nome={c.icone} size={13} className="text-amber-500 shrink-0" />
                    <p className="text-xs font-semibold text-slate-700 flex-1 truncate">{c.nome}</p>
                  </div>
                ))}
              </div>
            )}

            {adicionandoCategoria ? (
              <div className="space-y-2.5 border border-slate-200 rounded-xl p-3">
                <input
                  type="text"
                  value={nomeCategoria}
                  onChange={e => setNomeCategoria(e.target.value)}
                  placeholder="Nome da categoria"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleAdicionarCategoria()}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white transition"
                />
                <div className="grid grid-cols-6 gap-1.5">
                  {ICONE_KEYS.map(key => {
                    const Ic = ICONE_MAP[key]
                    return (
                      <button
                        key={key}
                        onClick={() => setIconeCategoria(key)}
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                          iconeCategoria === key
                            ? 'bg-amber-100 text-amber-600'
                            : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        <Ic size={14} />
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAdicionandoCategoria(false); setNomeCategoria('') }}
                    className="flex-1 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleAdicionarCategoria}
                    disabled={!nomeCategoria.trim() || salvandoCategoria}
                    className="flex-1 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {salvandoCategoria
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Check size={12} />}
                    {salvandoCategoria ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdicionandoCategoria(true)}
                className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                <Plus size={14} />
                Adicionar categoria
              </button>
            )}
          </div>

        </div>

        {/* CTA */}
        <button
          onClick={() => navigate('/', { replace: true })}
          disabled={!podeComecar}
          className="w-full py-3.5 bg-slate-900 text-white rounded-2xl text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
        >
          <ChevronRight size={16} />
          Tudo pronto, começar
        </button>

      </div>

      {modalCentro && (
        <ModalFormCentro
          centro={null}
          onClose={() => setModalCentro(false)}
          onSalvo={handleCentroSalvo}
        />
      )}
    </div>
  )
}
