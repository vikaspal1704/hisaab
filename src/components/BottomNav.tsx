import { NavLink, useNavigate } from 'react-router-dom'
import { IconActivity, IconGroups, IconHome, IconPlus, IconUser } from './icons'

const item = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
    isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-slate-400'
  }`

export function BottomNav() {
  const navigate = useNavigate()
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-lg items-end px-2 pt-1">
        <NavLink to="/" end className={item}><IconHome />Home</NavLink>
        <NavLink to="/groups" className={item}><IconGroups />Groups</NavLink>
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={() => navigate('/add')}
            aria-label="Add expense"
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg shadow-brand-700/30 active:bg-brand-800"
          >
            <IconPlus size={28} />
          </button>
        </div>
        <NavLink to="/activity" className={item}><IconActivity />Activity</NavLink>
        <NavLink to="/me" className={item}><IconUser />Me</NavLink>
      </div>
    </nav>
  )
}
