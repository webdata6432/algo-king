const h=React.createElement;
const menuPaths={
 market:'M3 18V7m6 11v-6m6 6V4m6 14v-8',
 test:'M8 3h8m-6 0v7l-6 9q-1 2 2 2h12q3 0 2-2l-6-9V3m-6 13h8',
 compare:'M3 6h10v4H3zm0 9h17v4H3z',
 angel:'M8 3v6m8-6v6M6 9h12v3a6 6 0 0 1-12 0zm6 9v4',
 depth:'M4 5h7m-7 5h12M4 15h8m-8 5h16'
};
function Navigation(){
 const [current,setCurrent]=React.useState(location.hash.slice(1)||'market');
 React.useEffect(()=>{const update=()=>setCurrent(location.hash.slice(1)||'market');window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[]);
 return Object.entries(pages).map(([id,label])=>h('a',{key:id,href:'#'+id,className:current===id?'active':'','aria-current':current===id?'page':undefined},h('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round','aria-hidden':true},h('path',{d:menuPaths[id]})),label));
}
ReactDOM.createRoot(document.getElementById('nav')).render(h(Navigation));
