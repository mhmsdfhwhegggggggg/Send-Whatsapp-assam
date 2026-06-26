import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, FolderKanban, FileText,
  Smartphone, Send, Settings, LogOut, Menu, X,
} from "lucide-react";
import { useState } from "react";

const NAV = [
  { href: "/", icon: LayoutDashboard, label: "لوحة التحكم" },
  { href: "/students", icon: Users, label: "المستفيدون" },
  { href: "/groups", icon: FolderKanban, label: "المجموعات" },
  { href: "/templates", icon: FileText, label: "القوالب" },
  { href: "/accounts", icon: Smartphone, label: "حسابات واتساب" },
  { href: "/campaigns", icon: Send, label: "الحملات" },
  { href: "/settings", icon: Settings, label: "الإعدادات" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const logout = () => {
    localStorage.removeItem("token");
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className={`
        fixed inset-y-0 right-0 z-50 w-64 bg-white border-l border-slate-200 flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${open ? "translate-x-0" : "translate-x-full md:translate-x-0"}
      `}>
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-[#1B7A3D] flex items-center justify-center ml-3">
            <Send className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg text-slate-900">المؤسسة</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                <div className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer
                  ${active
                    ? "bg-[#E8F5EE] text-[#1B7A3D]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}
                `}>
                  <Icon className="w-5 h-5 shrink-0" />
                  {label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-100">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-4 sticky top-0 z-30">
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex-1" />
          <div className="text-sm text-slate-500 hidden sm:block">نظام إرسال واتساب الجماعي</div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
