import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

export default function Quotations() {
  const [quotations, setQuotations] = useState([])
  const [enquiries, setEnquiries] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { user } = useAuth()

  const [form, setForm] = useState({
    enquiry_id: '', valid_until: '',
    items: [{ product_id: '', quantity: 1, unit_price: 0, discount_percent: 0, gst_percent: 18 }]
  })

  async function load() {
    try {
      const [q, e, p] = await Promise.all([
        axios.get('/api/quotations'),
        axios.get('/api/enquiries'),
        axios.get('/api/products'),
      ])
      setQuotations(q.data)
      setEnquiries(e.data.filter(x => x.status !== 'WON' && x.status !== 'LOST'))
      setProducts(p.data)
    } catch (err) { setError(err.response?.data?.error || 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function selectEnquiry(id) {
    const eq = enquiries.find(x => x.id === id)
    if (eq) {
      const items = eq.items.map(it => ({
        product_id: it.product_id,
        quantity: it.quantity,
        unit_price: it.base_price,
        discount_percent: 0,
        gst_percent: 18,
      }))
      setForm({ ...form, enquiry_id: id, items })
    } else {
      setForm({ ...form, enquiry_id: id })
    }
  }

  function calcLine(it) {
    const base = it.quantity * it.unit_price
    const disc = base * ((it.discount_percent || 0) / 100)
    const afterDisc = base - disc
    const gst = afterDisc * ((it.gst_percent || 0) / 100)
    return parseFloat((afterDisc + gst).toFixed(2))
  }

  function calcGrandTotal() {
    return form.items.reduce((sum, it) => sum + calcLine(it), 0).toFixed(2)
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { product_id: '', quantity: 1, unit_price: 0, discount_percent: 0, gst_percent: 18 }] })
  }
  function updateItem(idx, field, val) {
    const items = [...form.items]
    items[idx][field] = field === 'quantity' ? parseInt(val) || 0 : field === 'unit_price' ? parseFloat(val) || 0 : parseFloat(val) || 0
    setForm({ ...form, items })
  }
  function removeItem(idx) {
    if (form.items.length === 1) return
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.enquiry_id) { setError('Select an enquiry'); return }
    const validItems = form.items.filter(i => i.product_id && i.quantity > 0 && i.unit_price >= 0)
    if (validItems.length === 0) { setError('Add at least one valid product item'); return }
    try {
      await axios.post('/api/quotations', { ...form, items: validItems })
      setShowCreate(false)
      setSuccess('Quotation created!')
      setTimeout(() => setSuccess(''), 3000)
      setForm({ enquiry_id: '', valid_until: '', items: [{ product_id: '', quantity: 1, unit_price: 0, discount_percent: 0, gst_percent: 18 }] })
      load()
    } catch (err) { setError(err.response?.data?.error || 'Failed') }
  }

  async function updateStatus(id, status) {
    if (confirm(`Change status to ${status}?`)) {
      try {
        await axios.patch(`/api/quotations/${id}/status`, { status })
        load()
      } catch (err) { alert(err.response?.data?.error || 'Failed') }
    }
  }

  async function convertToOrder(id) {
    if (confirm('Convert this quotation to a Sales Order?')) {
      try {
        const res = await axios.post(`/api/quotations/${id}/convert`)
        setSuccess(`Sales Order ${res.data.order_number} created!`)
        setTimeout(() => setSuccess(''), 4000)
        load()
      } catch (err) { alert(err.response?.data?.error || 'Failed to convert') }
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <div className="page-header">
        <h2>📝 Quotations</h2>
        {(user.role === 'SALES' || user.role === 'ADMIN') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Quotation</button>
        )}
      </div>
      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Quotation #</th>
            <th>Enquiry</th>
            <th>Customer</th>
            <th>Valid Until</th>
            <th>Grand Total</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotations.length === 0 ? (
            <tr><td colSpan="7"><div className="empty-state"><p>No quotations yet.</p></div></td></tr>
          ) : quotations.map(q => (
            <tr key={q.id}>
              <td><strong>{q.quotation_number}</strong></td>
              <td>{q.enquiry_number}</td>
              <td>{q.company_name}<br /><small style={{ color: '#64748b' }}>{q.contact_person}</small></td>
              <td>{q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '-'}</td>
              <td>₹{parseFloat(q.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td><span className={`status status-${q.status}`}>{q.status}</span></td>
              <td className="actions-cell">
                {q.status === 'DRAFT' && (
                  <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(q.id, 'SENT')}>Mark SENT</button>
                )}
                {q.status === 'SENT' && (
                  <>
                    <button className="btn btn-sm btn-success" onClick={() => updateStatus(q.id, 'ACCEPTED')}>Accept</button>
                    <button className="btn btn-sm btn-danger" onClick={() => updateStatus(q.id, 'REJECTED')}>Reject</button>
                  </>
                )}
                {q.status === 'ACCEPTED' && (
                  <button className="btn btn-sm btn-warning" onClick={() => convertToOrder(q.id)}>→ Convert to Sales Order</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1100 }}>
            <div className="modal-header">
              <h3>Create New Quotation</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <h4 className="section-title">Basic Details</h4>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Enquiry *</label>
                    <select className="form-control" value={form.enquiry_id}
                      onChange={e => selectEnquiry(e.target.value)}>
                      <option value="">-- Select Enquiry --</option>
                      {enquiries.map(e => (
                        <option key={e.id} value={e.id}>{e.enquiry_number} - {e.company_name} ({e.items.length} items)</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Valid Until</label>
                    <input type="date" className="form-control" value={form.valid_until}
                      onChange={e => setForm({ ...form, valid_until: e.target.value })} />
                  </div>
                </div>

                <h4 className="section-title">Items</h4>
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ width: 90 }}>Qty</th>
                      <th style={{ width: 120 }}>Unit Price</th>
                      <th style={{ width: 90 }}>Disc %</th>
                      <th style={{ width: 90 }}>GST %</th>
                      <th style={{ width: 120 }}>Line Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <select value={it.product_id} onChange={e => updateItem(idx, 'product_id', e.target.value)}>
                            <option value="">-- Product --</option>
                            {products.map(p => (
                              <option key={p.id} value={p.id}>{p.product_code} - {p.product_name}</option>
                            ))}
                          </select>
                        </td>
                        <td><input type="number" min="1" value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" value={it.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} /></td>
                        <td><input type="number" min="0" max="100" step="0.01" value={it.discount_percent} onChange={e => updateItem(idx, 'discount_percent', e.target.value)} /></td>
                        <td><input type="number" min="0" max="100" step="0.01" value={it.gst_percent} onChange={e => updateItem(idx, 'gst_percent', e.target.value)} /></td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{calcLine(it).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td><button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(idx)} disabled={form.items.length === 1}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Add Item</button>
                <div className="summary-row">
                  <span className="label">Grand Total:</span>
                  <span className="amount">₹{parseFloat(calcGrandTotal()).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Quotation</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
