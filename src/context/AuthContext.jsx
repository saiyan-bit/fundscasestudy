import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const savedToken = localStorage.getItem('erp_token')
    const savedUser = localStorage.getItem('erp_user')
    if (savedToken && savedUser) {
      setToken(savedToken)
      try { setUser(JSON.parse(savedUser)) } catch (e) {}
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete axios.defaults.headers.common['Authorization']
    }
  }, [token])

  async function login(username, password) {
    const res = await axios.post('/api/auth/login', { username, password })
    const { user: u, token: t } = res.data
    setUser(u)
    setToken(t)
    localStorage.setItem('erp_token', t)
    localStorage.setItem('erp_user', JSON.stringify(u))
    return u
  }

  function logout() {
    setUser(null)
    setToken(null)
    localStorage.removeItem('erp_token')
    localStorage.removeItem('erp_user')
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
