import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import Login from './pages/Login.jsx'
import Enquiries from './pages/Enquiries.jsx'
import Quotations from './pages/Quotations.jsx'
import SalesOrders from './pages/SalesOrders.jsx'

function PrivateRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <div style={{ padding: 40, textAlign: 'center' }}>
      <h2>Access Denied</h2>
      <p>You do not have permission to view this page.</p>
      <Link to="/">Go back</Link>
    </div>
  }
  return children
}

function Navbar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (!user) return null
  const isActive = (path) => location.pathname === path

  return (
    <nav className="navbar">
      <h1>Industrial ERP<span> ⚙️ </span>Supply Management System</h1>
      <div className="nav-links">
        <Link to="/enquiries" className={isActive('/enquiries') ? 'active' : ''}>Enquiries</Link>
        <Link to="/quotations" className={isActive('/quotations') ? 'active' : ''}>Quotations</Link>
        <Link to="/sales-orders" className={isActive('/sales-orders') ? 'active' : ''}>Sales Orders</Link>
        <div className="user-badge">
          {user.fullName}
          <span className={`role-tag ${user.role}`}>{user.role}</span>
        </div>
        <button onClick={() => { logout(); navigate('/login') }}>Logout</button>
      </div>
    </nav>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>

  return (
    <div className="app-container">
      {user && <Navbar />}
      <div className="main-content">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={user ? <Navigate to="/enquiries" /> : <Navigate to="/login" />} />
          <Route path="/enquiries" element={
            <PrivateRoute allowedRoles={['ADMIN', 'SALES']}>
              <Enquiries />
            </PrivateRoute>
          } />
          <Route path="/quotations" element={
            <PrivateRoute allowedRoles={['ADMIN', 'SALES']}>
              <Quotations />
            </PrivateRoute>
          } />
          <Route path="/sales-orders" element={
            <PrivateRoute allowedRoles={['ADMIN', 'SALES']}>
              <SalesOrders />
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </div>
  )
}
