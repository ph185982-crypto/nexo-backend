// Tema claro/escuro e menu recolhido: mesmas chaves e mesmo comportamento da Central (kit Avanteza, GUIA.md).
// Sob app.avanteza.com.br/comercial a origem é a da Central: as escolhas valem nos dois módulos.
// Fica fora dos componentes de cliente para o layout (servidor) conseguir pôr os scripts no <head>.
export const THEME_KEY = "avanteza-tema";
export type Theme = "light" | "dark";
export const THEME_COLORS: Record<Theme, string> = { dark: "#0B1B33", light: "#F5F0E6" };

/**
 * Roda no <head>, antes da pintura (sem flash): escolha lembrada (localStorage > cookie > a chave antiga "theme"
 * do next-themes) ou a preferência do sistema; padrão escuro, como a Central. Põe data-theme (tokens do kit) e a
 * classe "dark" (variantes dark: do Tailwind) no <html>.
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}
if(t!=="light"&&t!=="dark"){t=null;try{var m=document.cookie.match(/(?:^|; )${THEME_KEY}=(light|dark)/);if(m)t=m[1]}catch(e){}}
if(!t){try{var o=localStorage.getItem("theme");if(o==="light"||o==="dark")t=o}catch(e){}}
if(!t){try{t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){t="dark"}}
d.setAttribute("data-theme",t);if(t==="dark")d.classList.add("dark");else d.classList.remove("dark")})();`;

// Menu lateral recolhido (só telas largas): data-sidebar="collapsed" no <html>, posto antes da pintura; o CSS faz o resto.
export const SIDEBAR_KEY = "avanteza-menu";
export type SidebarState = "expanded" | "collapsed";
export const SIDEBAR_INIT_SCRIPT = `(function(){var d=document.documentElement,v=null;try{v=localStorage.getItem("${SIDEBAR_KEY}")}catch(e){}
if(v!=="collapsed"&&v!=="expanded"){v=null;try{var m=document.cookie.match(/(?:^|; )${SIDEBAR_KEY}=(collapsed|expanded)/);if(m)v=m[1]}catch(e){}}
if(v==="collapsed")d.setAttribute("data-sidebar","collapsed")})();`;

export function lembrar(chave: string, valor: string) {
  try { localStorage.setItem(chave, valor); } catch { /* navegação privada: vale só nesta aba */ }
  try { document.cookie = `${chave}=${valor}; path=/; max-age=31536000; samesite=lax`; } catch { /* sem cookie */ }
}

export function aplicarTema(t: Theme) {
  const d = document.documentElement;
  d.setAttribute("data-theme", t);
  d.classList.toggle("dark", t === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[t]);
}
