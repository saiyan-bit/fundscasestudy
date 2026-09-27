import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext.jsx'

export default function SalesOrders() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dispatchModal, setDispatchModal] = useState(null)
  const [dispatchForm, setDispatchForm] = useState({
    dispatch_date: new Date().toISOString().split('T')[0],
    vehicle_number: '',
    driver_name: '',
    items: [],
  })
  const { user } = useAuth()

  async function load() {
    try {
      const [o, p] = await Promise.all([axios.get('/api/sales-orders'), axios.get('/api/products')])
      setOrders(o.data)
      setProducts(p.data)
    } catch (err) { setError(err.response?.data?.error || 'Failed') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function flash(msg, isError = false) {
    if (isError) { setError(msg); setTimeout(() => setError(''), 4000) }
    else { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }
  }

  async function confirmOrder(id) {
    if (!confirm('Confirm Sales Order? This will reserve inventory.')) return
    try {
      await axios.post(`/api/sales-orders/${id}/confirm`)
      flash('Order confirmed! Inventory reserved.')
      load()
    } catch (err) { flash(err.response?.data?.error || 'Failed', true) }
  }

  async function cancelOrder(id) {
    if (!confirm('Cancel this Sales Order? Reserved stock will be released.')) return
    try {
      await axios.post(`/api/sales-orders/${id}/cancel`)
      flash('Order cancelled. Reserved inventory released.')
      load()
    } catch (err) { flash(err.response?.data?.error || 'Failed', true) }
  }

  function openDispatch(so) {
    const existingMap = new Map()
    so.dispatches.forEach(d => {
      const prev = existingMap.get(d.product_id) || 0
      existingMap.set(d.product_id, prev + (parseInt(d.dispatched_quantity) || 0))
    })

    const items = so.items.map(it => {
      const prev = existingMap.get(it.product_id) || 0
      const remaining = it.quantity - prev
      return {
        sales_order_item_id: it.id,
        product_id: it.product_id,
        product_code: it.product_code,
        product_name: it.product_name,
        quantity: remaining > 0 ? remaining : 0,
        max_quantity: remaining,
      }
    }).filter(x => x.max_quantity > 0)

    if (items.length === 0) {
      alert('All items are fully dispatched.')
      return
    }
    setDispatchModal(so)
    setDispatchForm({
      dispatch_date: new Date().toISOString().split('T')[0],
      vehicle_number: '',
      driver_name: '',
      items,
    })
  }

  function updateDispatchItem(idx, val) {
    const items = [...dispatchForm.items]
    const v = parseInt(val) || 0
    items[idx].quantity = Math.max(0, Math.min(v, items[idx].max_quantity))
    setDispatchForm({ ...dispatchForm, items })
  }

  async function submitDispatch(e) {
    e.preventDefault()
    const items = dispatchForm.items.filter(i => i.quantity > 0)
    if (items.length === 0) { flash('At least one item required', true); return }
    if (!dispatchForm.dispatch_date) { flash('Dispatch date required', true); return }
    try {
      await axios.post(`/api/sales-orders/${dispatchModal.id}/dispatch`, { ...dispatchForm, items })
      setDispatchModal(null)
      flash('Dispatch processed successfully! Physical and reserved inventory updated.')
      load()
    } catch (err) { flash(err.response?.data?.error || 'Failed', true) }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <div className="page-header">
        <h2>📦 Sales Orders & Dispatch</h2>
      </div>
      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h4 className="section-title">📊 Inventory Overview</h4>
        <table className="table" style={{ boxShadow: 'none' }}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Product</th>
              <th>Category</th>
              <th>Base Price</th>
              <th style={{ textAlign: 'center' }}>Physical</th>
              <th style={{ textAlign: 'center' }}>Reserved</th>
              <th style={{ textAlign: 'center' }}>Available</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const avail = (p.physical_quantity || 0) - (p.reserved_quantity || 0)
              return (
                <tr key={p.id}>
                  <td><strong>{p.product_code}</strong></td>
                  <td>{p.product_name}</td>
                  <td><span className="badge">{p.category}</span></td>
                  <td>₹{parseFloat(p.base_price).toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{p.physical_quantity || 0}</td>
                  <td style={{ textAlign: 'center', color: '#d97706', fontWeight: 600 }}>{p.reserved_quantity || 0}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`inventory-cell ${avail === 0 ? 'inv-out' : avail < 50 ? 'inv-low' : 'inv-ok'}`}>
                      {avail} {p.unit}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginBottom: 14, color: '#0f172a' }}>All Sales Orders</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Order #</th>
            <th>Quotation</th>
            <th>Customer</th>
            <th>Order Date</th>
            <th>Products</th>
            <th>Total</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan="8"><div className="empty-state"><p>No sales orders yet. Convert an ACCEPTED quotation to create one.</p></div></td></tr>
          ) : orders.map(so => (
            <tr key={so.id}>
              <td><strong>{so.order_number}</strong></td>
              <td>{so.quotation_number}</td>
              <td>{so.company_name}<br /><small style={{ color: '#64748b' }}>{so.contact_person} · {so.mobile}</small></td>
              <td>{new Date(so.order_date).toLocaleDateString()}</td>
              <td>
                {so.items.map(it => {
                  const avail = it.available_quantity || 0
                  const canFulfil = avail >= it.quantity
                  return (
                    <div key={it.id} style={{ fontSize: 12, marginBottom: 4 }}>
                      {it.product_name} × <strong>{it.quantity}</strong>
                      <span style={{ marginLeft: 6 }} className={`inventory-cell ${avail === 0 ? 'inv-out' : !canFulfil ? 'inv-low' : 'inv-ok'}`}>
                        Avail: {avail}
                      </span>
                    </div>
                  )
                })}
                {so.dispatches.length > 0 && (
                  <div style={{ fontSize: 11, color: '#16a34a', marginTop: 6, fontStyle: 'italic' }}>
                    ✔ Dispatched: {so.dispatches.length} time(s)
                  </div>
                )}
              </td>
              <td>₹{parseFloat(so.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td><span className={`status status-${so.status}`}>{so.status}</span></td>
              <td className="actions-cell" style={{ flexWrap: 'wrap' }}>
                {so.status === 'PENDING' && (
                  <>
                    <button className="btn btn-sm btn-success" onClick={() => confirmOrder(so.id)} disabled={user.role !== 'ADMIN'} title={user.role !== 'ADMIN' ? 'Admin only' : ''}>
                      ✓ Confirm & Reserve
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => cancelOrder(so.id)} disabled={user.role !== 'ADMIN'}>
                      Cancel
                    </button>
                  </>
                )}
                {so.status === 'CONFIRMED' && (
                  <>
                    <button className="btn btn-sm btn-warning" onClick={() => openDispatch(so)} disabled={user.role !== 'ADMIN'}>
                      🚚 Dispatch
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => cancelOrder(so.id)} disabled={user.role !== 'ADMIN'}>
                      Cancel
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {dispatchModal && (
        <div className="modal-backdrop" onClick={() => setDispatchModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h3>Dispatch Order: {dispatchModal.order_number}</h3>
              <button className="modal-close" onClick={() => setDispatchModal(null)}>×</button>
            </div>
            <form onSubmit={submitDispatch}>
              <div className="modal-body">
                <div className="info-grid" style={{ background: '#f8fafc', padding: 14, borderRadius: 6 }}>
                  <div className="info-item"><span className="k">Customer:</span><span className="v">{dispatchModal.company_name}</span></div>
                  <div className="info-item"><span className="k">Quotation:</span><span className="v">{dispatchModal.quotation_number}</span></div>
                  <div className="info-item"><span className="k">Order Status:</span><span className="v"><span className={`status status-${dispatchModal.status}`}>{dispatchModal.status}</span></span></div>
                  <div className="info-item"><span className="k">Total Order:</span><span className="v">₹{parseFloat(dispatchModal.total_amount).toLocaleString('en-IN')}</span></div>
                </div>

                <h4 className="section-title" style={{ marginTop: 20 }}>Dispatch Details</h4>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Dispatch Date *</label>
                    <input type="date" className="form-control" value={dispatchForm.dispatch_date}
                      onChange={e => setDispatchForm({ ...dispatchForm, dispatch_date: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Vehicle Number</label>
                    <input className="form-control" placeholder="e.g. MH-12-AB-1234" value={dispatchForm.vehicle_number}
                      onChange={e => setDispatchForm({ ...dispatchForm, vehicle_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Driver Name</label>
                    <input className="form-control" placeholder="Driver name" value={dispatchForm.driver_name}
                      onChange={e => setDispatchForm({ ...dispatchForm, driver_name: e.target.value })} />
                  </div>
                </div>

                <h4 className="section-title">Items to Dispatch</h4>
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ width: 140, textAlign: 'center' }}>Order Qty</th>
                      <th style={{ width: 140, textAlign: 'center' }}>Remaining</th>
                      <th style={{ width: 160 }}>Dispatch Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchForm.items.map((it, idx) => (
                      <tr key={idx}>
                        <td><strong>{it.product_code}</strong> - {it.product_name}</td>
                        <td style={{ textAlign: 'center' }}>{dispatchModal.items.find(x => x.id === it.sales_order_item_id)?.quantity}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: '#0ea5e9' }}>{it.max_quantity}</td>
                        <td>
                          <input type="number" min="0" max={it.max_quantity} value={it.quantity}
                            onChange={e => updateDispatchItem(idx, e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                  ℹ️ On dispatch: Physical quantity decreases AND Reserved quantity decreases by same amount.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDispatchModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-warning">🚚 Process Dispatch</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
