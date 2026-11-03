import { createRouter, createWebHashHistory } from 'vue-router'
export default createRouter({ history: createWebHashHistory(), routes: [
  { path: '/', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/server/:id', name: 'Server', component: () => import('../views/ServerDetail.vue') },
  { path: '/:pathMatch(.*)*', component: { template: '<main class="container"><h1>此入口不受 LeoBridge 支持</h1><p>本桥接器只提供监控展示，不包含管理后台。</p><a href="/#/">返回首页</a></main>' } }
] })
