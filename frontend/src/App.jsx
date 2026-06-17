import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Activity, 
  Building2, 
  Plus, 
  Trash2, 
  Check, 
  AlertTriangle, 
  FileText, 
  Settings, 
  ChevronRight, 
  Calendar, 
  Droplet, 
  Zap, 
  FileDown, 
  X,
  Edit,
  Power,
  RotateCcw
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('record'); // 'record' | 'history' | 'manage'
  const [period, setPeriod] = useState('2026-06'); // default billing period
  const [shops, setShops] = useState([]);
  const [ledgerData, setLedgerData] = useState(null); // ledger report state
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false); // real-time preview modal
  
  // Modal states for Readings entry
  const [editingShop, setEditingShop] = useState(null);
  const [readingsForm, setReadingsForm] = useState([]);
  
  // Modal states for Management
  const [showAddShopModal, setShowAddShopModal] = useState(false);
  const [newShopCode, setNewShopCode] = useState('');
  const [newShopName, setNewShopName] = useState('');
  const [newLaborFee, setNewLaborFee] = useState(30);
  const [newRubbishFee, setNewRubbishFee] = useState(50);
  
  // Meter manager states
  const [selectedShopForMeter, setSelectedShopForMeter] = useState(null);
  const [showAddMeterModal, setShowAddMeterModal] = useState(false);
  const [newMeterType, setNewMeterType] = useState('electricity');
  const [newMeterName, setNewMeterName] = useState('电表1');
  const [newMeterPrice, setNewMeterPrice] = useState(1.03);

  // Calculate locked status (natural months limit)
  const getCurrentPeriod = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const currentPeriodStr = getCurrentPeriod();
  const isPeriodLocked = period < currentPeriodStr;

  // Fetch shops when tab or period changes
  const fetchShops = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/shops?period=${period}`);
      setShops(res.data);
    } catch (err) {
      console.error('Error fetching shops:', err);
      alert('无法获取商铺列表，请确保后端服务正常运行！');
    } finally {
      setLoading(false);
    }
  };

  // Fetch ledger for history tab
  const fetchLedger = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/reports/ledger?period=${period}`);
      setLedgerData(res.data);
    } catch (err) {
      console.error('Error fetching ledger report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShops();
    if (activeTab === 'history') {
      fetchLedger();
    }
  }, [activeTab, period]);

  // Handle opening readings input for a shop
  const handleOpenReadings = async (shop) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/shops/${shop.id}/readings?period=${period}`);
      setEditingShop(shop);
      setReadingsForm(res.data);
    } catch (err) {
      console.error('Error fetching readings:', err);
      alert('获取该店水电表信息失败，请重试！');
    } finally {
      setLoading(false);
    }
  };

  // Handle current reading input change in form
  const handleReadingChange = (meterId, val) => {
    setReadingsForm(prev => 
      prev.map(m => m.meterId === meterId ? { ...m, currentReading: val } : m)
    );
  };

  // Submit bulk readings
  const handleSubmitReadings = async (e) => {
    e.preventDefault();
    
    // Front-end validations: current must be >= previous
    for (const m of readingsForm) {
      if (m.currentReading !== null && m.currentReading !== '') {
        const curr = parseFloat(m.currentReading);
        if (curr < m.previousReading) {
          alert(`错误：【${m.meterName}】本期读数 (${curr}) 不能小于上期读数 (${m.previousReading})！`);
          return;
        }
      }
    }
    
    setLoading(true);
    try {
      await axios.post('/api/readings/bulk', {
        period,
        readings: readingsForm.map(m => ({
          meterId: m.meterId,
          previousReading: m.previousReading,
          currentReading: m.currentReading
        }))
      });
      setEditingShop(null);
      fetchShops();
    } catch (err) {
      console.error('Error saving readings:', err);
      alert('保存读数失败，请重试！');
    } finally {
      setLoading(false);
    }
  };

  // One-click Export PDF
  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const response = await axios({
        url: '/api/export/pdf',
        method: 'POST',
        data: { period },
        responseType: 'blob', // Important: response is a file blob
      });
      
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `${period}抄表计费通知单.pdf`;
      link.click();
    } catch (err) {
      console.error('Error exporting PDF:', err);
      if (err.response && err.response.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const errorObj = JSON.parse(reader.result);
            alert(`一键生成 PDF 失败：${errorObj.error}\n\n服务器错误详情：\n${errorObj.details || ''}`);
          } catch (_) {
            alert('一键生成 PDF 账单失败，请确保服务器上已正确安装 LibreOffice 并且水电读数已录入完整！');
          }
        };
        reader.readAsText(err.response.data);
      } else {
        alert('一键生成 PDF 账单失败，请检查网络并确保服务器上已安装 LibreOffice！');
      }
    } finally {
      setExporting(false);
    }
  };

  // Create Shop
  const handleAddShop = async (e) => {
    e.preventDefault();
    if (!newShopCode || !newShopName) return;
    try {
      await axios.post('/api/shops', {
        shopCode: newShopCode,
        shopName: newShopName,
        laborFee: parseFloat(newLaborFee),
        rubbishFee: parseFloat(newRubbishFee)
      });
      setShowAddShopModal(false);
      setNewShopCode('');
      setNewShopName('');
      fetchShops();
    } catch (err) {
      alert('添加商铺失败：' + (err.response?.data?.error || err.message));
    }
  };

  // Create Meter
  const handleAddMeter = async (e) => {
    e.preventDefault();
    if (!selectedShopForMeter) return;
    try {
      await axios.post(`/api/shops/${selectedShopForMeter.id}/meters`, {
        meterType: newMeterType,
        meterName: newMeterName,
        unitPrice: parseFloat(newMeterPrice)
      });
      setShowAddMeterModal(false);
      // Reload specific shop meters by closing and opening readings/or refreshing shops list
      fetchShops();
      setSelectedShopForMeter(null);
    } catch (err) {
      alert('添加表计失败：' + (err.response?.data?.error || err.message));
    }
  };

  // Toggle Meter Active status
  const handleToggleMeter = async (meterId, currentStatus) => {
    const confirmMsg = currentStatus 
      ? '确定要禁用此表计吗？禁用后该表将不参与后续账期的录入，但历史抄表数据仍将被保留。' 
      : '确定要启用此表计吗？';
    if (!window.confirm(confirmMsg)) return;
    
    try {
      await axios.put(`/api/meters/${meterId}`, { isActive: !currentStatus });
      alert('状态更新成功！');
      fetchShops();
    } catch (err) {
      alert('修改表计状态失败：' + err.message);
    }
  };

  // Auto-set meter price based on type
  useEffect(() => {
    if (newMeterType === 'water') {
      setNewMeterName('水表');
      setNewMeterPrice(4.13);
    } else {
      setNewMeterName('电表1');
      setNewMeterPrice(1.03);
    }
  }, [newMeterType]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row pb-12 md:pb-0">
      
      {/* Sidebar - Desktop / Tabbar - Mobile */}
      <aside className="w-full md:w-64 bg-slate-900 text-slate-100 flex md:flex-col justify-between p-4 md:p-6 border-b md:border-b-0 md:border-r border-slate-800 z-10 sticky top-0 md:h-screen">
        <div className="flex flex-row md:flex-col items-center md:items-start justify-between w-full md:w-auto">
          <div className="flex items-center space-x-2 md:mb-8">
            <span className="text-2xl">⚡</span>
            <h1 className="text-lg md:text-xl font-bold tracking-wider bg-gradient-to-r from-yellow-400 to-amber-300 bg-clip-text text-transparent">水电计费系统</h1>
          </div>
          
          <nav className="flex md:flex-col space-x-2 md:space-x-0 md:space-y-2">
            <button 
              onClick={() => setActiveTab('record')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'record' ? 'bg-amber-500 text-slate-950 font-bold' : 'hover:bg-slate-800 text-slate-300'}`}
            >
              <Activity size={16} />
              <span>抄表录入</span>
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'history' ? 'bg-amber-500 text-slate-950 font-bold' : 'hover:bg-slate-800 text-slate-300'}`}
            >
              <FileText size={16} />
              <span>历史看板</span>
            </button>
            <button 
              onClick={() => setActiveTab('manage')}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'manage' ? 'bg-amber-500 text-slate-950 font-bold' : 'hover:bg-slate-800 text-slate-300'}`}
            >
              <Settings size={16} />
              <span>表计配置</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full overflow-y-auto">
        
        {/* Header Block */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-200">
          <div>
            <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">可视化数字化管理</span>
            <h2 className="text-2xl font-black text-gray-800">
              {activeTab === 'record' ? '水电表数据录入' : activeTab === 'history' ? '水电历史财务看板' : '商铺与表计配置管理'}
            </h2>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {/* Period Picker */}
            <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-200">
              <Calendar size={16} className="text-gray-400" />
              <select 
                value={period} 
                onChange={(e) => setPeriod(e.target.value)}
                className="text-sm font-bold bg-transparent outline-none text-gray-700 cursor-pointer"
              >
                <option value="2025-09">2025年9月</option>
                <option value="2025-10">2025年10月</option>
                <option value="2025-11">2025年11月</option>
                <option value="2025-12">2025年12月</option>
                <option value="2026-01">2026年1月</option>
                <option value="2026-02">2026年2月</option>
                <option value="2026-03">2026年3月</option>
                <option value="2026-04">2026年4月</option>
                <option value="2026-05">2026年5月</option>
                <option value="2026-06">2026年6月</option>
                <option value="2026-07">2026年7月</option>
                <option value="2026-08">2026年8月</option>
              </select>
            </div>
            
            {/* Download PDF button */}
            <button 
              onClick={handleExportPdf}
              disabled={exporting}
              className="flex items-center justify-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-2 rounded-xl shadow-sm text-sm font-bold hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 transition-all flex-1 sm:flex-none"
            >
              <FileDown size={16} className={exporting ? 'animate-bounce' : ''} />
              <span>{exporting ? '正在导出...' : '一键生成 PDF'}</span>
            </button>
          </div>
        </header>

        {/* Dashboard Stats */}
        {activeTab === 'record' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <Building2 size={20} />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400">总商铺数</p>
                <p className="text-xl font-black text-gray-800">{shops.length} 家</p>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <Check size={20} />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400">抄表进度</p>
                <p className="text-xl font-black text-gray-800">100%</p>
              </div>
            </div>
            
            <div className="hidden sm:flex bg-white p-4 rounded-2xl shadow-sm border border-gray-100 items-center space-x-4">
              <div className="p-3 bg-yellow-50 text-yellow-600 rounded-xl">
                <Activity size={20} />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400">当前计费账期</p>
                <p className="text-sm font-black text-gray-800">{period}</p>
              </div>
            </div>
          </div>
        )}

        {/* Active Tab: RECORD (Readings Entry) */}
        {activeTab === 'record' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-gray-700 text-sm">商铺列表</h3>
                <span className="hidden sm:inline text-xs text-gray-400">| 点击商铺卡片快速进行数据抄表</span>
              </div>
              <button 
                onClick={async () => {
                  setLoading(true);
                  try {
                    const res = await axios.get(`/api/reports/ledger?period=${period}`);
                    setLedgerData(res.data);
                    setShowPreviewModal(true);
                  } catch (err) {
                    console.error('Error loading preview:', err);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex items-center justify-center space-x-1 border border-amber-500 text-amber-600 hover:bg-amber-50 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm w-full sm:w-auto"
              >
                <Activity size={14} />
                <span>📊 预览本月数据明细</span>
              </button>
            </div>
            
            {loading && shops.length === 0 ? (
              <div className="text-center py-12 text-gray-400">加载中...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {shops.map((shop) => (
                  <div 
                    key={shop.id}
                    onClick={() => handleOpenReadings(shop)}
                    className="bg-white p-5 rounded-2xl border border-gray-100 hover:border-amber-300 shadow-sm hover:shadow-md cursor-pointer transition-all flex justify-between items-center group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="bg-slate-100 text-slate-800 text-xs font-bold px-2 py-0.5 rounded-lg">{shop.shop_code}</span>
                        <h4 className="font-bold text-gray-800 group-hover:text-amber-600 transition-colors">{shop.shop_name}</h4>
                      </div>
                      <div className="flex items-center space-x-3 text-xs text-gray-400 pt-1">
                        <span>人工费: ¥{shop.labor_fee}</span>
                        <span>垃圾费: ¥{shop.rubbish_fee}</span>
                        <span>表计: {shop.meter_count} 个</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {shop.meter_count > 0 && shop.completed_count === shop.meter_count ? (
                        <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                          <span>已录入</span>
                        </span>
                      ) : (
                        <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                          <span>待抄表</span>
                        </span>
                      )}
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-amber-500 transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active Tab: HISTORY (Historical Ledger Dashboard) */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-700 text-sm">【{period}】水电费月度财务明细汇总</h3>
              <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-1 rounded-lg">
                财务级汇总
              </span>
            </div>

            {loading && !ledgerData ? (
              <div className="text-center py-12 text-gray-400">正在生成月度财务明细...</div>
            ) : ledgerData && ledgerData.shops ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-gray-100">
                        <th className="py-4 px-5">铺面</th>
                        <th className="py-4 px-3">店铺名称</th>
                        <th className="py-4 px-3 text-right">水用量(吨)</th>
                        <th className="py-4 px-3 text-right">水费(元)</th>
                        <th className="py-4 px-3 text-right">电用量(度)</th>
                        <th className="py-4 px-3 text-right">电费(元)</th>
                        <th className="py-4 px-3 text-right">人工费(元)</th>
                        <th className="py-4 px-3 text-right">垃圾费(元)</th>
                        <th className="py-4 px-5 text-right font-black text-slate-600">小计(元)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                      {ledgerData.shops.map((s) => (
                        <tr key={s.shop_id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-4 px-5 font-bold text-slate-800">{s.shop_code}</td>
                          <td className="py-4 px-3 font-semibold text-gray-800">{s.shop_name}</td>
                          <td className="py-4 px-3 text-right text-gray-500">{s.water_usage.toFixed(1)}</td>
                          <td className="py-4 px-3 text-right text-blue-600 font-bold">¥{s.water_fee}</td>
                          <td className="py-4 px-3 text-right text-gray-500">{s.electricity_usage.toFixed(1)}</td>
                          <td className="py-4 px-3 text-right text-amber-600 font-bold">¥{s.electricity_fee}</td>
                          <td className="py-4 px-3 text-right text-gray-500">¥{s.labor_fee}</td>
                          <td className="py-4 px-3 text-right text-gray-500">¥{s.rubbish_fee}</td>
                          <td className="py-4 px-5 text-right font-extrabold text-amber-700 bg-amber-50/20">¥{s.total_fee}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900 text-slate-100 font-extrabold text-sm border-t border-slate-800">
                        <td className="py-5 px-5" colSpan="2">本月财务合计</td>
                        <td className="py-5 px-3"></td>
                        <td className="py-5 px-3 text-right text-blue-400">¥{ledgerData.totals?.water_fee || 0}</td>
                        <td className="py-5 px-3"></td>
                        <td className="py-5 px-3 text-right text-amber-400">¥{ledgerData.totals?.electricity_fee || 0}</td>
                        <td className="py-5 px-3 text-right text-slate-300">¥{ledgerData.totals?.labor_fee || 0}</td>
                        <td className="py-5 px-3 text-right text-slate-300">¥{ledgerData.totals?.rubbish_fee || 0}</td>
                        <td className="py-5 px-5 text-right text-yellow-400 bg-slate-800 text-base">¥{ledgerData.totals?.grand_total || 0}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">暂无该账期的账单财务数据。</p>
            )}
          </div>
        )}

        {/* Active Tab: MANAGE (Shop & Meter Configuration) */}
        {activeTab === 'manage' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-700 text-sm">配置店铺与表计数量</h3>
              <button 
                onClick={() => setShowAddShopModal(true)}
                className="flex items-center space-x-1 bg-amber-500 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs hover:bg-amber-600 transition-all shadow-sm"
              >
                <Plus size={14} />
                <span>新增店铺</span>
              </button>
            </div>

            {loading && shops.length === 0 ? (
              <div className="text-center py-12 text-gray-400">加载中...</div>
            ) : (
              <div className="space-y-4">
                {shops.map((shop) => (
                  <div key={shop.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-3 gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="bg-slate-100 text-slate-800 text-xs font-bold px-2.5 py-0.5 rounded-lg">{shop.shop_code}</span>
                        <h4 className="font-bold text-gray-800 text-lg">{shop.shop_name}</h4>
                      </div>
                      
                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        <span>水电人工费: <b className="text-gray-800">¥{shop.labor_fee}</b></span>
                        <span>垃圾处理费: <b className="text-gray-800">¥{shop.rubbish_fee}</b></span>
                      </div>
                    </div>

                    {/* Meter settings for this shop */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">对应表计配置 ({shop.metersList?.length || 0})</span>
                        <button 
                          onClick={() => {
                            setSelectedShopForMeter(shop);
                            setShowAddMeterModal(true);
                          }}
                          className="flex items-center space-x-0.5 text-amber-600 hover:text-amber-700 font-bold text-xs"
                        >
                          <Plus size={12} />
                          <span>新增表计</span>
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {shop.metersList && shop.metersList.length > 0 ? (
                          shop.metersList.map((m) => (
                            <div key={m.id} className={`flex items-center justify-between p-3 rounded-xl border ${m.is_active ? 'bg-slate-50 border-gray-100' : 'bg-gray-100 border-gray-200 opacity-60'}`}>
                              <div className="flex items-center space-x-2">
                                {m.meter_type === 'water' ? (
                                  <Droplet size={14} className="text-blue-500" />
                                ) : (
                                  <Zap size={14} className="text-amber-500" />
                                )}
                                <div>
                                  <p className="font-bold text-sm text-gray-800">{m.meter_name}</p>
                                  <p className="text-[10px] text-gray-400">¥{m.unit_price}/{m.meter_type === 'water' ? '吨' : '度'}</p>
                                </div>
                              </div>
                              
                              <button 
                                onClick={() => handleToggleMeter(m.id, m.is_active)}
                                className={`p-1.5 rounded-lg transition-colors ${m.is_active ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                                title={m.is_active ? '禁用表计' : '启用表计'}
                              >
                                <Power size={14} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-gray-400 italic col-span-2">暂无表计配置，请点击右侧新增表计。</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* Modal: Slide-up Drawer for Meter Readings Entry */}
      {editingShop && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[90vh] overflow-y-auto shadow-xl flex flex-col transition-all transform animate-slide-up">
            
            {/* Drawer Header */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">当前账期: {period}</span>
                <div className="flex items-center space-x-2">
                  <span className="bg-amber-100 text-amber-800 text-xs font-black px-2 py-0.5 rounded-lg">{editingShop.shop_code}</span>
                  <h3 className="font-extrabold text-gray-800 text-lg">{editingShop.shop_name}</h3>
                </div>
              </div>
              <button 
                onClick={() => setEditingShop(null)}
                className="p-1.5 hover:bg-slate-100 rounded-full text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Readings Form */}
            <form onSubmit={handleSubmitReadings} className="p-6 space-y-6 flex-1">
              {isPeriodLocked && (
                <div className="bg-slate-100 text-slate-600 text-xs px-4 py-2.5 rounded-xl flex items-center space-x-2 font-bold mb-4 border border-gray-200">
                  <AlertTriangle size={14} className="text-amber-500 animate-pulse flex-shrink-0" />
                  <span>历史账期已结算锁定（不可编辑）。当前处于只读查看模式。</span>
                </div>
              )}
              <div className="space-y-4">
                {readingsForm.map((m) => (
                  <div key={m.meterId} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-1.5">
                        {m.meterType === 'water' ? (
                          <Droplet size={14} className="text-blue-500" />
                        ) : (
                          <Zap size={14} className="text-amber-500" />
                        )}
                        <span className="font-bold text-sm text-slate-800">{m.meterName}</span>
                      </div>
                      <span className="text-xs text-slate-400">单价: ¥{m.unitPrice}/{m.meterType === 'water' ? '吨' : '度'}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Previous Reading (Read-only) */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">上期读数</label>
                        <div className="bg-slate-200 text-slate-600 font-bold px-3 py-2 rounded-xl text-sm border border-slate-300">
                          {m.previousReading}
                        </div>
                      </div>

                      {/* Current Reading (Input) */}
                      <div>
                        <label className="text-[10px] font-bold text-amber-600 uppercase">本期读数</label>
                        <input 
                          type="number" 
                          step="0.01"
                          required
                          disabled={isPeriodLocked}
                          value={m.currentReading === null ? '' : m.currentReading}
                          onChange={(e) => handleReadingChange(m.meterId, e.target.value)}
                          placeholder="请输入读数"
                          className="bg-white text-slate-900 font-extrabold px-3 py-2 rounded-xl text-sm border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 w-full disabled:bg-gray-100 disabled:border-gray-200 disabled:text-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex space-x-3 pt-4 border-t border-gray-100">
                {isPeriodLocked ? (
                  <button 
                    type="button"
                    onClick={() => setEditingShop(null)}
                    className="w-full bg-slate-800 hover:bg-slate-900 text-white font-extrabold py-3 rounded-xl text-sm transition-colors shadow-md text-center"
                  >
                    关闭只读查看
                  </button>
                ) : (
                  <>
                    <button 
                      type="button"
                      onClick={() => setEditingShop(null)}
                      className="flex-1 border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors"
                    >
                      取消
                    </button>
                    <button 
                      type="submit"
                      disabled={loading}
                      className="flex-1 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-950 font-black py-3 rounded-xl text-sm transition-colors shadow-md disabled:opacity-50"
                    >
                      {loading ? '正在保存...' : '提交当月数据'}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add New Shop */}
      {showAddShopModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <h3 className="font-bold text-gray-800 text-lg">新增店铺</h3>
              <button onClick={() => setShowAddShopModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddShop} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">铺面编号</label>
                <input 
                  type="text" 
                  required
                  placeholder="如: 22#"
                  value={newShopCode}
                  onChange={(e) => setNewShopCode(e.target.value)}
                  className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">商铺名称</label>
                <input 
                  type="text" 
                  required
                  placeholder="如: 绝味鸭脖"
                  value={newShopName}
                  onChange={(e) => setNewShopName(e.target.value)}
                  className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">人工管理费</label>
                  <input 
                    type="number" 
                    required
                    value={newLaborFee}
                    onChange={(e) => setNewLaborFee(e.target.value)}
                    className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">垃圾处理费</label>
                  <input 
                    type="number" 
                    required
                    value={newRubbishFee}
                    onChange={(e) => setNewRubbishFee(e.target.value)}
                    className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none"
                  />
                </div>
              </div>

              <button 
                type="submit"
                className="w-full bg-amber-500 text-slate-950 font-bold py-2.5 rounded-xl text-sm hover:bg-amber-600 transition-colors shadow-sm"
              >
                确定新增
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add New Meter */}
      {showAddMeterModal && selectedShopForMeter && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <h3 className="font-bold text-gray-800 text-base">为 【{selectedShopForMeter.shop_name}】 新增表计</h3>
              <button onClick={() => setShowAddMeterModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddMeter} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">表计类型</label>
                <select 
                  value={newMeterType} 
                  onChange={(e) => setNewMeterType(e.target.value)}
                  className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                >
                  <option value="electricity">电表 (Electricity)</option>
                  <option value="water">水表 (Water)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">表计名称</label>
                <input 
                  type="text" 
                  required
                  placeholder="如: 电表2, 动力电表"
                  value={newMeterName}
                  onChange={(e) => setNewMeterName(e.target.value)}
                  className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">独立计费单价</label>
                <input 
                  type="number" 
                  step="0.0001"
                  required
                  value={newMeterPrice}
                  onChange={(e) => setNewMeterPrice(e.target.value)}
                  className="border border-gray-200 px-3 py-2 rounded-xl text-sm w-full focus:outline-none"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-amber-500 text-slate-950 font-bold py-2.5 rounded-xl text-sm hover:bg-amber-600 transition-colors shadow-sm"
              >
                添加并启用
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Real-time Billing Ledger Preview */}
      {showPreviewModal && ledgerData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto flex flex-col transition-all transform animate-scale-up">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">实时计算明细</span>
                <h3 className="font-extrabold text-gray-800 text-lg">【{period}】账期水电费数据预览表</h3>
              </div>
              <button 
                onClick={() => setShowPreviewModal(false)}
                className="p-1.5 hover:bg-slate-100 rounded-full text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content - Table */}
            <div className="p-6 overflow-x-auto flex-1">
              <p className="text-xs text-amber-600 font-bold mb-4 flex items-center space-x-1">
                <AlertTriangle size={14} className="animate-pulse flex-shrink-0" />
                <span>此表为实时计算结果（已应用四舍五入）。未抄完铺面将显示为零用量，抄表完成后自动同步更新。</span>
              </p>
              
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-gray-100">
                    <th className="py-3 px-4">铺面</th>
                    <th className="py-3 px-3">店铺名称</th>
                    <th className="py-3 px-3 text-right">水用量(吨)</th>
                    <th className="py-3 px-3 text-right">水费(元)</th>
                    <th className="py-3 px-3 text-right">电用量(度)</th>
                    <th className="py-3 px-3 text-right">电费(元)</th>
                    <th className="py-3 px-3 text-right">人工费(元)</th>
                    <th className="py-3 px-3 text-right">垃圾费(元)</th>
                    <th className="py-3 px-4 text-right font-black text-slate-600">小计(元)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                  {ledgerData.shops.map((s) => (
                    <tr key={s.shop_id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-800">{s.shop_code}</td>
                      <td className="py-3 px-3 font-semibold text-gray-800">{s.shop_name}</td>
                      <td className="py-3 px-3 text-right text-gray-400">{s.water_usage.toFixed(1)}</td>
                      <td className="py-3 px-3 text-right text-blue-600 font-bold">¥{s.water_fee}</td>
                      <td className="py-3 px-3 text-right text-gray-400">{s.electricity_usage.toFixed(1)}</td>
                      <td className="py-3 px-3 text-right text-amber-600 font-bold">¥{s.electricity_fee}</td>
                      <td className="py-3 px-3 text-right text-gray-400">¥{s.labor_fee}</td>
                      <td className="py-3 px-3 text-right text-gray-400">¥{s.rubbish_fee}</td>
                      <td className="py-3 px-4 text-right font-extrabold text-amber-700 bg-amber-50/10">¥{s.total_fee}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900 text-slate-100 font-extrabold text-sm border-t border-slate-800">
                    <td className="py-4 px-4" colSpan="2">当前预估财务合计</td>
                    <td className="py-4 px-3"></td>
                    <td className="py-4 px-3 text-right text-blue-400">¥{ledgerData.totals?.water_fee || 0}</td>
                    <td className="py-4 px-3"></td>
                    <td className="py-4 px-3 text-right text-amber-400">¥{ledgerData.totals?.electricity_fee || 0}</td>
                    <td className="py-4 px-3 text-right text-slate-300">¥{ledgerData.totals?.labor_fee || 0}</td>
                    <td className="py-4 px-3 text-right text-slate-300">¥{ledgerData.totals?.rubbish_fee || 0}</td>
                    <td className="py-4 px-4 text-right text-yellow-400 bg-slate-800 text-base">¥{ledgerData.totals?.grand_total || 0}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 flex justify-end bg-slate-50 rounded-b-2xl">
              <button 
                onClick={() => setShowPreviewModal(false)}
                className="bg-slate-800 hover:bg-slate-900 text-white font-extrabold px-6 py-2 rounded-xl text-sm transition-colors shadow-sm"
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
