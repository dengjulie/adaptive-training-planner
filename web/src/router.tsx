import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout.tsx'
import { ConnectionsPage } from './pages/ConnectionsPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { OuraDayPage } from './pages/OuraDayPage.tsx'
import { OuraPage } from './pages/OuraPage.tsx'
import { PlanPage } from './pages/PlanPage.tsx'
import { RecoveryPage } from './pages/RecoveryPage.tsx'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <PlanPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: 'recovery', element: <RecoveryPage /> },
      { path: 'oura', element: <OuraPage /> },
      { path: 'oura/:day', element: <OuraDayPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
