import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      })

      if (error) {
        setErro('E-mail ou senha inválidos.')
        return
      }

      navigate('/')
    } catch (error) {
      if (import.meta.env.DEV) console.error('Erro ao fazer login:', error)
      setErro('Não foi possível entrar. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid min-h-[620px] lg:grid-cols-[0.9fr_1.1fr]">
          <aside className="hidden bg-slate-950 p-10 lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <Wallet size={19} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">GestaoSmart</p>
                  <p className="text-xs text-slate-400">FastBills</p>
                </div>
              </div>

              <div className="mt-14 max-w-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Gestão financeira operacional
                </p>
                <h1 className="mt-4 text-3xl font-semibold leading-tight text-white">
                  Controle de contas por imóvel, sem ruído.
                </h1>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  Acompanhe vencimentos, titulares e avisos em um ambiente pensado para rotina de gestão.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm text-slate-300">
              {['Controle por imóvel', 'Avisos automáticos', 'Resumo financeiro'].map((item) => (
                <div key={item} className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span>{item}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </div>
              ))}
              <p className="pt-5 text-xs text-slate-500">Acesso restrito aos espaços autorizados.</p>
            </div>
          </aside>

          <div className="flex items-center justify-center px-5 py-8 sm:px-10">
            <div className="w-full max-w-md">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950">
                  <Wallet size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-base font-semibold text-slate-950">GestaoSmart</p>
                  <p className="text-xs text-slate-500">FastBills</p>
                </div>
              </div>

              <div className="mb-7">
                <p className="text-sm font-medium text-slate-500">Acesso ao sistema</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Entrar</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Use suas credenciais para acessar a gestão de contas e imóveis.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">E-mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="seu@email.com"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Senha</label>
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    required
                    placeholder="Digite sua senha"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-100"
                  />
                </div>

                {erro && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    {erro}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={carregando}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {carregando && <Loader2 size={16} className="animate-spin" />}
                  {carregando ? 'Entrando...' : 'Entrar'}
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-slate-400">
                Ambiente seguro para gestão de contas e imóveis.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
