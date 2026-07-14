import { useState, useEffect, useRef } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { LayoutDashboard, Building2, FileText, BarChart2, Bell, Settings } from 'lucide-react'
import { supabase } from './lib/supabase'
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext'
import Dashboard from './pages/Dashboard'
import Imoveis from './pages/Imoveis'
import Contas from './pages/Contas'
import Resumo from './pages/Resumo'
import Avisos from './pages/Avisos'
import Onboarding from './pages/Onboarding'
import Login from './pages/Login'

const NAV = [
  { path: '/',        label: 'Dashboard', icon: LayoutDashboard },
  { path: '/imoveis', label: 'Imóveis',   icon: Building2 },
  { path: '/contas',  label: 'Contas',    icon: FileText },
  { path: '/resumo',  label: 'Resumo',    icon: BarChart2 },
  { path: '/avisos',  label: 'Avisos',    icon: Bell },
]

function mesAtual() {
  const m = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return m.charAt(0).toUpperCase() + m.slice(1)
}

function Layout({ user, vencidos }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [saindo, setSaindo] = useState(false)
  const [erroSair, setErroSair] = useState('')

  const currentLabel = NAV.find((item) => item.path === location.pathname)?.label ?? 'Dashboard'
  const userInitial = user?.email?.[0]?.toUpperCase() ?? 'U'

  async function handleSignOut() {
    setErroSair('')
    setSaindo(true)

    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      navigate('/login')
    } catch (error) {
      if (import.meta.env.DEV) console.error('Erro ao sair:', error)
      setErroSair('Não foi possível sair. Tente novamente.')
    } finally {
      setSaindo(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">

      {/* Header — com nav no desktop */}
      <header className="bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between px-4 h-12">

          {/* Esquerda: logo + nav desktop */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="hidden md:block text-slate-900 font-semibold text-sm mr-3 shrink-0">
              Gestão de Contas
            </span>
            <nav className="hidden md:flex items-center gap-0.5">
              {NAV.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <span className="relative">
                    <Icon size={16} />
                    {label === 'Avisos' && vencidos > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-semibold rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                        {vencidos > 9 ? '9+' : vencidos}
                      </span>
                    )}
                  </span>
                  {label}
                </NavLink>
              ))}
            </nav>
            {/* Título da página no mobile */}
            <h1 className="md:hidden font-semibold text-slate-900 text-sm">{currentLabel}</h1>
          </div>

          {/* Direita: mês + usuário */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:block text-xs text-slate-400">{mesAtual()}</span>
            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center justify-center">
              {userInitial}
            </span>
            <button
              onClick={handleSignOut}
              disabled={saindo}
              title="Sair"
              className="text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
        {erroSair && (
          <div className="px-4 pb-2">
            <p className="text-xs text-red-500 text-right">{erroSair}</p>
          </div>
        )}
      </header>

      {/* Conteúdo principal */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — visivel apenas no mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex z-10">
        {NAV.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className="flex-1 flex flex-col items-center relative pt-1.5 pb-2"
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-slate-900 rounded-full" />
                )}
                <span className="relative">
                  <Icon
                    size={20}
                    className={isActive ? 'text-slate-900' : 'text-slate-400'}
                  />
                  {label === 'Avisos' && vencidos > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-semibold rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                      {vencidos > 9 ? '9+' : vencidos}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[10px] mt-0.5 ${
                    isActive ? 'text-slate-900 font-medium' : 'text-slate-400'
                  }`}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function AppRoutes({ user, vencidos, setVencidos }) {
  const navigate = useNavigate()
  const lastCheckedUserRef = useRef(null)
  const { workspaceId, loadingWorkspace, erroWorkspace } = useWorkspace()

  useEffect(() => {
    if (!user || loadingWorkspace || erroWorkspace || !workspaceId || lastCheckedUserRef.current === `${user.id}:${workspaceId}`) return
    lastCheckedUserRef.current = `${user.id}:${workspaceId}`

    Promise.all([
      supabase.from('centros_custo').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('titulares').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('categorias').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    ]).then(([c, t, cat]) => {
      const isEmpty =
        (c.count ?? 0) === 0 &&
        (t.count ?? 0) === 0 &&
        (cat.count ?? 0) === 0
      if (isEmpty) navigate('/onboarding', { replace: true })
    })
  }, [user, workspaceId, loadingWorkspace, erroWorkspace])

  useEffect(() => {
    if (!user || !workspaceId) {
      setVencidos(0)
      return
    }

    supabase
      .from('lancamentos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'vencido')
      .eq('workspace_id', workspaceId)
      .then(({ count }) => setVencidos(count ?? 0))
  }, [user, workspaceId, setVencidos])

  if (user && erroWorkspace) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 p-4">
        <span className="text-red-500 text-sm text-center">{erroWorkspace}</span>
      </div>
    )
  }

  if (user && (loadingWorkspace || !workspaceId)) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <span className="text-slate-400 text-sm">Carregando workspace...</span>
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/onboarding"
        element={user ? <Onboarding /> : <Navigate to="/login" replace />}
      />
      <Route
        element={
          user
            ? <Layout user={user} vencidos={vencidos} />
            : <Navigate to="/login" replace />
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="imoveis" element={<Imoveis />} />
        <Route path="contas" element={<Contas />} />
        <Route path="resumo" element={<Resumo />} />
        <Route path="avisos" element={<Avisos />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [vencidos, setVencidos] = useState(0)

  useEffect(() => {
    let ativo = true

    async function carregarSessao() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        if (ativo) setUser(session?.user ?? null)
      } catch (error) {
        if (import.meta.env.DEV) console.error('Erro ao carregar sessão:', error)
        if (ativo) setUser(null)
      }
    }

    carregarSessao()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      ativo = false
      subscription.unsubscribe()
    }
  }, [])

  if (user === undefined) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <span className="text-slate-400 text-sm">Carregando...</span>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <WorkspaceProvider key={user?.id ?? 'anon'} user={user}>
        <AppRoutes user={user} vencidos={vencidos} setVencidos={setVencidos} />
      </WorkspaceProvider>
    </BrowserRouter>
  )
}
