import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Plus, MoreVertical, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { formatarMoeda as formatarValor, localISODate } from '../lib/utils'
import ModalFormCentro from '../components/ModalFormCentro'
import ModalTrocarTitular from '../components/ModalTrocarTitular'

// ── Helpers ──────────────────────────────────────────────────

const TIPO_LABEL = {
  casa:        'Casa',
  apartamento: 'Apartamento',
  comercial:   'Comercial',
  pessoal:     'Pessoal',
  outro:       'Outro',
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

function CardCentro({ centro, titulares, totalMensal, contasCount, onEditar, onAlterarStatus, onTrocarTitular, onVerContas }) {
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef(null)
  const isAtivo = centro.status === 'ativo'

  useEffect(() => {
    if (!menuAberto) return
    function handler(e) {
      if (!menuRef.current?.contains(e.target)) setMenuAberto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuAberto])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 leading-tight truncate">{centro.nome}</p>
          <p className="text-xs text-slate-400 mt-0.5">{TIPO_LABEL[centro.tipo] ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
              isAtivo ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isAtivo ? 'Ativo' : 'Em configuração'}
          </span>
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
                <MenuBtn label="Ver contas" onClick={() => { onVerContas(); setMenuAberto(false) }} />
                <MenuBtn label="Trocar titular" onClick={() => { onTrocarTitular(); setMenuAberto(false) }} />
                <div className="h-px bg-slate-100 my-1" />
                <MenuBtn
                  label={isAtivo ? 'Desativar' : 'Ativar'}
                  onClick={() => { onAlterarStatus(); setMenuAberto(false) }}
                  danger={isAtivo}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Avatares dos titulares */}
      {titulares.length > 0 && (
        <div className="flex items-center">
          {titulares.slice(0, 6).map((t, i) => (
            <div
              key={t.id}
              title={t.nome}
              className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${i > 0 ? '-ml-2' : ''}`}
              style={{ backgroundColor: t.cor }}
            >
              {t.nome[0]?.toUpperCase()}
            </div>
          ))}
          {titulares.length > 6 && (
            <div className="w-7 h-7 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-slate-600 text-[11px] font-bold -ml-2">
              +{titulares.length - 6}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <div>
          <p className="text-[11px] text-slate-400 font-medium">Total mensal</p>
          <p className="text-sm font-bold text-slate-900 mt-0.5">{formatarValor(totalMensal)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400 font-medium">Contas</p>
          <p className="text-sm font-bold text-slate-900 mt-0.5">{contasCount}</p>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────

export default function Imoveis() {
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()
  const navigate = useNavigate()

  const [centros, setCentros]                   = useState([])
  const [contas, setContas]                     = useState([])
  const [lancamentosMes, setLancamentosMes]     = useState([])
  const [todosOsTitulares, setTodosOsTitulares] = useState([])
  const [loading, setLoading]                   = useState(true)
  const [erroCarregamento, setErroCarregamento] = useState('')

  const [modalCadastro, setModalCadastro]           = useState(false)
  const [modalEdicao, setModalEdicao]               = useState(null)
  const [modalTrocarTitular, setModalTrocarTitular] = useState(null)

  const fetchData = useCallback(async () => {
    if (loadingWorkspace || erroWorkspace || !workspaceId) return

    setLoading(true)
    setErroCarregamento('')

    const now = new Date()
    const y   = now.getFullYear()
    const m   = now.getMonth()
    const inicioMes = localISODate(new Date(y, m, 1))
    const fimMes    = localISODate(new Date(y, m + 1, 0))

    const [
      { data: cs, error: erroCs },
      { data: ct, error: erroCt },
      { data: lc, error: erroLc },
      { data: ts, error: erroTs },
    ] = await Promise.all([
      supabase.from('centros_custo').select('*').eq('workspace_id', workspaceId).order('nome'),
      supabase.from('contas').select('id, nome, centro_id, titular_id, titulares:titulares!contas_workspace_titular_fkey(id, nome, cor)').eq('workspace_id', workspaceId),
      supabase
        .from('lancamentos')
        .select('valor, contas:contas!lancamentos_workspace_conta_fkey(centro_id)')
        .gte('vencimento', inicioMes)
        .lte('vencimento', fimMes)
        .eq('workspace_id', workspaceId),
      supabase.from('titulares').select('*').eq('workspace_id', workspaceId).order('nome'),
    ])

    const erro = erroCs || erroCt || erroLc || erroTs
    if (erro) {
      if (import.meta.env.DEV) console.error('Erro ao carregar imóveis:', erro)
      setErroCarregamento('Não foi possível carregar os imóveis. Tente novamente.')
      setLoading(false)
      return
    }

    setCentros(cs ?? [])
    setContas(ct ?? [])
    setLancamentosMes(lc ?? [])
    setTodosOsTitulares(ts ?? [])
    setLoading(false)
  }, [workspaceId, loadingWorkspace, erroWorkspace])

  useEffect(() => { fetchData() }, [fetchData])

  // Titulares únicos por centro (via contas.titular_id)
  const titularesPorCentro = useMemo(() => {
    const result = {}
    contas.forEach(c => {
      if (!c.centro_id) return
      if (!result[c.centro_id]) result[c.centro_id] = new Map()
      if (c.titular_id && c.titulares) {
        result[c.centro_id].set(c.titular_id, c.titulares)
      }
    })
    return Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, Array.from(v.values())])
    )
  }, [contas])

  // Soma dos lançamentos do mês por centro
  const totalMensalPorCentro = useMemo(() => {
    const result = {}
    lancamentosMes.forEach(l => {
      const cid = l.contas?.centro_id
      if (!cid) return
      result[cid] = (result[cid] ?? 0) + (l.valor ?? 0)
    })
    return result
  }, [lancamentosMes])

  // Quantidade de contas por centro
  const contasCountPorCentro = useMemo(() => {
    const result = {}
    contas.forEach(c => {
      if (!c.centro_id) return
      result[c.centro_id] = (result[c.centro_id] ?? 0) + 1
    })
    return result
  }, [contas])

  // ── Handlers ──

  function handleCentroSalvo(data) {
    setCentros(prev => {
      const existe = prev.find(c => c.id === data.id)
      const lista  = existe
        ? prev.map(c => (c.id === data.id ? data : c))
        : [...prev, data]
      return lista.sort((a, b) => a.nome.localeCompare(b.nome))
    })
    setModalCadastro(false)
    setModalEdicao(null)
  }

  async function handleAlterarStatus(centro) {
    const novoStatus = centro.status === 'ativo' ? 'configuracao' : 'ativo'
    const { data, error } = await supabase
      .from('centros_custo')
      .update({ status: novoStatus })
      .eq('id', centro.id)
      .eq('workspace_id', workspaceId)
      .select()
      .single()
    if (!error) {
      setCentros(prev => prev.map(c => (c.id === centro.id ? data : c)))
    }
  }

  function handleTrocarTitularSalvo() {
    setModalTrocarTitular(null)
    fetchData()
  }

  // ── Render ──

  if (erroWorkspace) {
    return <p className="text-sm text-red-500">{erroWorkspace}</p>
  }

  if (erroCarregamento) {
    return <p className="text-sm text-red-500">{erroCarregamento}</p>
  }

  if (loadingWorkspace || loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 size={20} className="animate-spin text-slate-300" />
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* Header da lista */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {centros.length} {centros.length === 1 ? 'imóvel' : 'imóveis'}
        </p>
        <button
          onClick={() => setModalCadastro(true)}
          className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
        >
          <Plus size={14} />
          Adicionar
        </button>
      </div>

      {/* Grade */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {centros.map(centro => (
          <CardCentro
            key={centro.id}
            centro={centro}
            titulares={titularesPorCentro[centro.id] ?? []}
            totalMensal={totalMensalPorCentro[centro.id] ?? 0}
            contasCount={contasCountPorCentro[centro.id] ?? 0}
            onEditar={() => setModalEdicao(centro)}
            onAlterarStatus={() => handleAlterarStatus(centro)}
            onTrocarTitular={() => setModalTrocarTitular(centro)}
            onVerContas={() => navigate('/contas', { state: { centroId: centro.id } })}
          />
        ))}

        {/* Card dashed — novo centro */}
        <button
          onClick={() => setModalCadastro(true)}
          className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-3 p-8 text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors min-h-[160px]"
        >
          <Plus size={22} />
          <span className="text-sm font-medium">Novo imóvel</span>
        </button>
      </div>

      {/* Modais */}
      {modalCadastro && (
        <ModalFormCentro
          centro={null}
          onClose={() => setModalCadastro(false)}
          onSalvo={handleCentroSalvo}
        />
      )}

      {modalEdicao && (
        <ModalFormCentro
          centro={modalEdicao}
          onClose={() => setModalEdicao(null)}
          onSalvo={handleCentroSalvo}
        />
      )}

      {modalTrocarTitular && (
        <ModalTrocarTitular
          centro={modalTrocarTitular}
          titulares={todosOsTitulares}
          onClose={() => setModalTrocarTitular(null)}
          onSalvo={handleTrocarTitularSalvo}
        />
      )}
    </div>
  )
}
