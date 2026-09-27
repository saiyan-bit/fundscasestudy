import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    login(username, password)
      .then(() => navigate(location.state?.from?.pathname || '/enquiries'))
      .catch(err => setError(err.response?.data?.error || 'Login failed'))
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="login-wrap" style={{ position: 'fixed', inset: 0, zIndex: 999 }}>
      <div className="login-card">
        <h2>Sign In</h2>
        <p className="subtitle">Industrial ERP - Sales Management System</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input type="text" className="form-control" value={username}
              onChange={e => setUsername(e.target.value)} placeholder="admin or sales"
              disabled={submitting} autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" className="form-control" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              disabled={submitting} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div className="login-creds">
          <h4>Test Credentials:</h4>
          <code><strong>ADMIN:</strong> admin / admin123</code>
          <code><strong>SALES:</strong> sales / sales123</code>
        </div>
      </div>
    </div>
  )
}
