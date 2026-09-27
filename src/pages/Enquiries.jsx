import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

export default function Enquiries() {
  const [enquiries, setEnquiries] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { user } = useAuth()

  const [newCustomer, setNewCustomer] = useState({ show: false, company_name: '', contact_person: '', mobile: '', email: '', city: '' })
  const [form, setForm] = useState({
    customer_id: '', enquiry_date: new Date().toISOString().split('T')[0],
    required_date: '', notes: '', items: [{ product_id: '', quantity: 1 }]
  })

  async function load() {
    try {
      const [e, c, p] = await Promise.all([
        axios.get('/api/enquiries'),
        axios.get('/api/customers'),
        axios.get('/api/products'),
      ])
      setEnquiries(e.data)
      setCustomers(c.data)
      setProducts(p.data)
    } catch (err) { setError(err.response?.data?.error || 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleAddCustomer() {
    if (!newCustomer.company_name || !newCustomer.contact_person || !newCustomer.mobile) {
      alert('Company, Contact Person and Mobile are required')
      return
    }
    try {
      const res = await axios.post('/api/customers', newCustomer)
      setCustomers([...customers, res.data])
      setForm({ ...form, customer_id: res.data.id })
      setNewCustomer({ show: false, company_name: '', contact_person: '', mobile: '', email: '', city: '' })
    } catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { product_id: '', quantity: 1 }] })
  }
  function updateItem(idx, field, val) {
    const items = [...form.items]
    items[idx][field] = val
    setForm({ ...form, items })
  }
  function removeItem(idx) {
    if (form.items.length === 1) return
    const items = form.items.filter((_, i) => i !== idx)
    setForm({ ...form, items })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.customer_id) { setError('Select or create a customer'); return }
    const items = form.items.filter(i => i.product_id && i.quantity > 0)
    if (items.length === 0) { setError('Add at least one product with valid quantity'); return }
    try {
      await axios.post('/api/enquiries', { ...form, items })
      setShowCreate(false)
      setSuccess('Enquiry created successfully!')
      setTimeout(() => setSuccess(''), 3000)
      setForm({ customer_id: '', enquiry_date: new Date().toISOString().split('T')[0], required_date: '', notes: '', items: [{ product_id: '', quantity: 1 }] })
      load()
    } catch (err) { setError(err.response?.data?.error || 'Failed to create enquiry') }
  }

  async function updateStatus(id, status) {
    try {
      await axios.patch(`/api/enquiries/${id}/status`, { status })
      load()
    } catch (err) { alert(err.response?.data?.error || 'Failed') }
  }

  if (loading) return <div>Loading enquiries...</div>

  return (
    <div>
      <div className="page-header">
        <h2>📋 Customer Enquiries</h2>
        {user.role === 'SALES' || user.role === 'ADMIN' ? (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Enquiry</button>
        ) : null}
      </div>
      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Enquiry #</th>
            <th>Customer</th>
            <th>Date</th>
            <th>Required By</th>
            <th>Products</th>
            <th>Status</th>
            <th>Created By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {enquiries.length === 0 ? (
            <tr><td colSpan="8"><div className="empty-state"><p>No enquiries yet. Create your first enquiry!</p></div></td></tr>
          ) : enquiries.map(eq => (
            <tr key={eq.id}>
              <td><strong>{eq.enquiry_number}</strong></td>
              <td>{eq.company_name}<br /><small style={{ color: '#64748b' }}>{eq.contact_person} · {eq.city}</small></td>
              <td>{new Date(eq.enquiry_date).toLocaleDateString()}</td>
              <td>{eq.required_date ? new Date(eq.required_date).toLocaleDateString() : '-'}</td>
              <td>
                {eq.items.map(it => (
                  <div key={it.id} style={{ fontSize: 12 }}>
                    {it.product_code} · {it.product_name} × {it.quantity}
                  </div>
                ))}
              </td>
              <td><span className={`status status-${eq.status}`}>{eq.status}</span></td>
              <td>{eq.created_by_name}</td>
              <td className="actions-cell">
                {(eq.status === 'NEW' || eq.status === 'QUOTED') && (
                  <>
                    <button className="btn btn-sm btn-success" onClick={() => updateStatus(eq.id, 'WON')}>Mark WON</button>
                    <button className="btn btn-sm btn-danger" onClick={() => updateStatus(eq.id, 'LOST')}>Mark LOST</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Enquiry</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <h4 className="section-title">Customer Details</h4>
                {!newCustomer.show ? (
                  <div className="grid-2">
                    <div className="form-group">
                      <label>Customer</label>
                      <select className="form-control" value={form.customer_id}
                        onChange={e => setForm({ ...form, customer_id: e.target.value })}>
                        <option value="">-- Select Customer --</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>{c.company_name} ({c.contact_person})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setNewCustomer({ ...newCustomer, show: true })}>+ New Customer</button>
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ background: '#f8fafc', marginBottom: 20 }}>
                    <div className="grid-3">
                      <div className="form-group">
                        <label>Company Name *</label>
                        <input className="form-control" value={newCustomer.company_name}
                          onChange={e => setNewCustomer({ ...newCustomer, company_name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Contact Person *</label>
                        <input className="form-control" value={newCustomer.contact_person}
                          onChange={e => setNewCustomer({ ...newCustomer, contact_person: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Mobile *</label>
                        <input className="form-control" value={newCustomer.mobile}
                          onChange={e => setNewCustomer({ ...newCustomer, mobile: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Email</label>
                        <input type="email" className="form-control" value={newCustomer.email}
                          onChange={e => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>City</label>
                        <input className="form-control" value={newCustomer.city}
                          onChange={e => setNewCustomer({ ...newCustomer, city: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-primary" onClick={handleAddCustomer}>Save</button>
                        <button type="button" className="btn btn-secondary" onClick={() => setNewCustomer({ ...newCustomer, show: false })}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}

                <h4 className="section-title">Enquiry Details</h4>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Enquiry Date *</label>
                    <input type="date" className="form-control" value={form.enquiry_date}
                      onChange={e => setForm({ ...form, enquiry_date: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Required Date</label>
                    <input type="date" className="form-control" value={form.required_date}
                      onChange={e => setForm({ ...form, required_date: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <input className="form-control" value={form.notes} placeholder="Any notes..."
                      onChange={e => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>

                <h4 className="section-title">Products</h4>
                <table className="items-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50%' }}>Product</th>
                      <th style={{ width: '20%' }}>Quantity</th>
                      <th style={{ width: '20%' }}>Available Stock</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, idx) => {
                      const p = products.find(x => x.id === it.product_id)
                      return (
                        <tr key={idx}>
                          <td>
                            <select value={it.product_id} onChange={e => updateItem(idx, 'product_id', e.target.value)}>
                              <option value="">-- Select Product --</option>
                              {products.map(pr => (
                                <option key={pr.id} value={pr.id}>{pr.product_code} - {pr.product_name} (₹{pr.base_price}/{pr.unit})</option>
                              ))}
                            </select>
                          </td>
                          <td><input type="number" min="1" value={it.quantity} onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)} /></td>
                          <td>{p ? (
                            <span className={`inventory-cell ${p.available_quantity === 0 ? 'inv-out' : p.available_quantity < it.quantity ? 'inv-low' : 'inv-ok'}`}>
                              {p.available_quantity || 0} {p.unit}
                            </span>
                          ) : '-'}</td>
                          <td><button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(idx)} disabled={form.items.length === 1}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Add Product</button>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Enquiry</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
