import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { ConnectionsPage } from './pages/ConnectionsPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ConnectionsPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
