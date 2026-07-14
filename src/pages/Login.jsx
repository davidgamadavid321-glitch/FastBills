import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Send } from 'lucide-react'
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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    })

    if (error) {
      setErro('E-mail ou senha inválidos.')
    } else {
      navigate('/')
    }

    setCarregando(false)
  }

  return (
    <div className="min-h-screen flex">

      {/* Painel lateral — hero, só desktop */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-1/2 bg-slate-900 flex-col justify-between p-12 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Wallet size={17} className="text-white" />
          </div>
          <span className="font-bold text-sm text-white tracking-wide">Gestão de Contas</span>
        </div>

        <div className="max-w-sm w-full">
          <h2 className="text-2xl font-bold tracking-tight leading-snug text-white mb-8">
            Contas, imóveis e vencimentos, sempre em dia.
          </h2>

          {/* Prévia realista do Dashboard — decorativa, dados fixos */}
          <div className="relative h-64">

            {/* Camada de trás — mini calendário */}
            <div className="absolute top-0 left-3 w-[85%] rotate-[-3deg] bg-white rounded-2xl shadow-xl shadow-black/20 p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Julho</p>
                <p className="text-[10px] font-semibold text-slate-300">Calendário</p>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {[
                  { d: 6, s: '' }, { d: 7, s: '' }, { d: 8, s: 'vencido' }, { d: 9, s: '' },
                  { d: 10, s: 'hoje' }, { d: 11, s: '' }, { d: 12, s: 'pago' },
                ].map(({ d, s }) => (
                  <div
                    key={d}
                    className={`h-7 rounded-md flex items-center justify-center text-[10px] font-bold tabular-nums ${
                      s === 'vencido' ? 'bg-red-50 text-red-700 border border-red-100'
                      : s === 'hoje' ? 'bg-amber-50 text-amber-700 border border-amber-100'
                      : s === 'pago' ? 'bg-green-50 text-green-700 border border-green-100'
                      : 'bg-slate-50 text-slate-400 border border-slate-100'
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>
            </div>

            {/* Camada da frente — resumo do mês, mesmas cores do Dashboard real */}
            <div className="absolute bottom-0 right-0 w-[92%] bg-white rounded-2xl shadow-2xl shadow-black/30 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">Resumo do mês</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-red-50 rounded-xl p-2.5">
                  <p className="text-[10px] text-red-600 font-semibold">Vencidos</p>
                  <p className="text-lg font-black text-red-700 leading-none tabular-nums mt-0.5">2</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-2.5">
                  <p className="text-[10px] text-amber-600 font-semibold">Vence hoje</p>
                  <p className="text-lg font-black text-amber-700 leading-none tabular-nums mt-0.5">1</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-2.5">
                  <p className="text-[10px] text-slate-500 font-semibold">Pendentes</p>
                  <p className="text-lg font-black text-slate-700 leading-none tabular-nums mt-0.5">3</p>
                </div>
                <div className="bg-green-50 rounded-xl p-2.5">
                  <p className="text-[10px] text-green-600 font-semibold">Pago no mês</p>
                  <p className="text-sm font-black text-green-700 leading-none tabular-nums mt-0.5">R$ 1.840,00</p>
                </div>
              </div>
            </div>

            {/* Chip flutuante — aviso Telegram */}
            <div className="absolute -bottom-4 -left-2 rotate-[3deg] bg-slate-800 rounded-xl shadow-lg px-3 py-2 flex items-center gap-2">
              <Send size={12} className="text-white/70 shrink-0" />
              <p className="text-[10px] text-white/80 whitespace-nowrap">Aluguel vence hoje</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500">Feito para quem cuida de contas e imóveis.</p>
      </div>

      {/* Formulário */}
      <div className="flex-1 flex items-center justify-center p-4 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-6 lg:hidden">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center mb-3">
              <Wallet size={22} className="text-white" />
            </div>
            <h1 className="text-slate-900 font-bold text-2xl tracking-tight">Gestão de Contas</h1>
            <p className="text-slate-500 text-sm mt-1">Faça login para continuar</p>

            <div className="w-full mt-4 rounded-xl bg-white border border-slate-100 shadow-sm px-3.5 py-2.5 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">Em aberto este mês</p>
              <p className="text-sm font-bold text-slate-900 tabular-nums">R$ 1.840,00</p>
            </div>

            <div className="flex items-center gap-1.5 mt-3 flex-wrap justify-center">
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />Vencidas
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Hoje
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />Próximas
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />Pagas
              </span>
            </div>
          </div>

          <div className="mb-6 hidden lg:block">
            <h1 className="text-slate-900 font-bold text-2xl tracking-tight">Entrar</h1>
            <p className="text-slate-500 text-sm mt-1">Faça login para continuar</p>
          </div>

          <div className="bg-white rounded-2xl ring-1 ring-slate-900/5 shadow-2xl shadow-slate-300/40 p-6 sm:p-10">

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="seu@email.com"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-700 mb-1.5">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition"
              />
            </div>

            {erro && (
              <p className="text-red-500 text-sm">{erro}</p>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-slate-900 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
          </div>
        </div>
      </div>
    </div>
  )
}
