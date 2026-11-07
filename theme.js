'use strict';
document.addEventListener('DOMContentLoaded',()=>{
  const button=document.getElementById('theme-toggle');
  if(!button)return;
  const root=document.documentElement;
  const render=()=>{
    const light=root.classList.contains('theme-light');
    document.getElementById('theme-icon').textContent=light?'☾':'☀';
    document.getElementById('theme-label').textContent=light?'Dark mode':'Light mode';
    button.setAttribute('aria-label',light?'Switch to dark mode':'Switch to light mode');
    button.setAttribute('aria-pressed',String(light));
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',light?'#f2f5fa':'#0a1020');
  };
  button.addEventListener('click',()=>{
    root.classList.toggle('theme-light');
    try{localStorage.setItem('hoist-theme',root.classList.contains('theme-light')?'light':'dark')}catch(e){}
    render();
  });
  render();
});
