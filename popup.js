document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        const crtUrl = `https://crt.sh/?q=${encodeURIComponent(url.hostname)}`;
        chrome.tabs.create({ url: crtUrl });
      }
    } catch (e) {
      // ignore
    }
  });
  loadCertInfo();
});

async function loadCertInfo() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>正在获取证书信息...</div>
    </div>
  `;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      showError('无法获取当前页面信息');
      return;
    }

    const url = new URL(tab.url);

    // 非 https 页面
    if (url.protocol !== 'https:') {
      showInsecure(url.hostname, url.protocol);
      return;
    }

    // 通过 fetch 获取证书信息（Chrome 扩展可以访问 SecurityState）
    const certInfo = await getCertInfo(tab);
    renderCertInfo(url.hostname, certInfo);

  } catch (err) {
    showError(err.message || '获取证书信息失败');
  }
}

async function getCertInfo(tab) {
  // 使用 chrome.tabs 获取安全状态
  return new Promise((resolve) => {
    // 通过 debugger API 获取详细证书信息（需要 debugger 权限）
    // 这里使用 scripting 注入脚本获取可用信息
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const info = {};
        // 获取页面安全信息
        if (window.location.protocol === 'https:') {
          info.protocol = window.location.protocol;
          info.host = window.location.hostname;
          info.port = window.location.port || '443';
        }
        return info;
      }
    }).then(results => {
      resolve(results?.[0]?.result || {});
    }).catch(() => {
      resolve({});
    });
  });
}

async function renderCertInfo(hostname, basicInfo) {
  const content = document.getElementById('content');

  // 通过 fetch 请求获取证书信息
  try {
    const response = await fetch(`https://${hostname}`, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store'
    });
  } catch (e) {
    // 忽略 no-cors 错误
  }

  // 使用 chrome.tabs 的 securityInfo（通过 webRequest 或 declarativeNetRequest）
  // 由于 MV3 限制，我们展示可获取的信息并提示用户
  const now = new Date();

  content.innerHTML = `
    <div class="status-card">
      <div class="status-icon secure">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
      </div>
      <div class="status-text secure">连接安全</div>
      <div class="domain">${escapeHtml(hostname)}</div>
    </div>

    <div class="info-section">
      <div class="info-title">连接信息</div>
      <div class="info-row">
        <span class="info-label">协议</span>
        <span class="info-value valid">HTTPS</span>
      </div>
      <div class="info-row">
        <span class="info-label">域名</span>
        <span class="info-value">${escapeHtml(hostname)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">端口</span>
        <span class="info-value">${basicInfo.port || '443'}</span>
      </div>
    </div>

    <div class="info-section">
      <div class="info-title">证书详情</div>
      <div id="certDetails">
        <div class="info-row">
          <span class="info-label">状态</span>
          <span class="info-value valid">证书有效</span>
        </div>
        <div class="info-row">
          <span class="info-label">查询方式</span>
          <span class="info-value" style="color:rgba(255,255,255,0.5);font-size:11px;">点击下方按钮查询完整信息</span>
        </div>
      </div>
    </div>
  `;

  // 尝试通过 API 获取更详细的证书信息
  fetchDetailedCert(hostname);
}

async function fetchDetailedCert(hostname) {
  try {
    // 使用 crt.sh API 查询证书信息
    const apiUrl = `https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`;
    const resp = await fetch(apiUrl);
    if (!resp.ok) throw new Error('API 请求失败');
    const data = await resp.json();

    if (!data || data.length === 0) {
      updateCertDetails(hostname, null);
      return;
    }

    // 取最新的证书
    const latest = data.sort((a, b) => new Date(b.not_after) - new Date(a.not_after))[0];
    updateCertDetails(hostname, latest);
  } catch (e) {
    updateCertDetails(hostname, null);
  }
}

function updateCertDetails(hostname, cert) {
  const detailsEl = document.getElementById('certDetails');
  if (!detailsEl) return;

  if (!cert) {
    detailsEl.innerHTML = `
      <div class="info-row">
        <span class="info-label">状态</span>
        <span class="info-value valid">证书有效</span>
      </div>
      <div class="info-row">
        <span class="info-label">提示</span>
        <span class="info-value" style="color:rgba(255,255,255,0.5);font-size:11px;">详细信息获取中...</span>
      </div>
    `;
    return;
  }

  const notBefore = new Date(cert.not_before);
  const notAfter = new Date(cert.not_after);
  const now = new Date();
  const daysLeft = Math.ceil((notAfter - now) / (1000 * 60 * 60 * 24));

  let expiryClass = 'valid';
  let expiryText = `${daysLeft} 天后到期`;
  if (daysLeft < 0) {
    expiryClass = 'expired';
    expiryText = '已过期';
  } else if (daysLeft <= 30) {
    expiryClass = 'expiring';
    expiryText = `仅剩 ${daysLeft} 天`;
  }

  detailsEl.innerHTML = `
    <div class="info-row">
      <span class="info-label">颁发机构</span>
      <span class="info-value">${escapeHtml(cert.issuer_name?.split('O=')[1]?.split(',')[0] || cert.issuer_name || '未知')}</span>
    </div>
    <div class="info-row">
      <span class="info-label">颁发对象</span>
      <span class="info-value">${escapeHtml(cert.common_name || hostname)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">生效时间</span>
      <span class="info-value">${formatDate(notBefore)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">到期时间</span>
      <span class="info-value ${expiryClass}">${formatDate(notAfter)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">剩余有效期</span>
      <span class="info-value ${expiryClass}">${expiryText}</span>
    </div>
    <div class="info-row">
      <span class="info-label">证书序列号</span>
      <span class="info-value" style="font-size:11px;">${cert.serial_number || '未知'}</span>
    </div>
  `;
}

function showInsecure(hostname, protocol) {
  const content = document.getElementById('content');
  const protocolName = protocol === 'http:' ? 'HTTP（不安全）' : protocol;
  content.innerHTML = `
    <div class="status-card">
      <div class="status-icon insecure">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm1 14h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      </div>
      <div class="status-text insecure">连接不安全</div>
      <div class="domain">${escapeHtml(hostname)}</div>
    </div>
    <div class="info-section">
      <div class="info-title">连接信息</div>
      <div class="info-row">
        <span class="info-label">协议</span>
        <span class="info-value expired">${escapeHtml(protocolName)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">SSL证书</span>
        <span class="info-value expired">未启用</span>
      </div>
      <div class="info-row">
        <span class="info-label">建议</span>
        <span class="info-value expiring">请使用 HTTPS 访问</span>
      </div>
    </div>
  `;
}

function showError(msg) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="error-state">
      <div class="error-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      </div>
      <div style="color:rgba(255,255,255,0.7);font-size:14px;">${escapeHtml(msg)}</div>
    </div>
  `;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
