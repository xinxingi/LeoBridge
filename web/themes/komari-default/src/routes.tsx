import Layout from './pages/_layout';
import Index from './pages/Index';
import Instance from './pages/instance';
export const routes = [{element: <Layout />, children: [
  {path: '/', element: <Index />},
  {path: '/instance/:uuid', element: <Instance />},
  {path: '*', element: <p>页面不存在</p>},
]}];
