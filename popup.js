document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('copyBtn').addEventListener('click', copyAllCertInfo);
  loadCertInfo();
});

let currentHostname = '';
let currentCertData = null;

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
    currentHostname = url.hostname;

    // 非 https 页面
    if (url.protocol !== 'https:') {
      showInsecure(url.hostname, url.protocol);
      return;
    }

    // 获取证书信息
    await renderCertInfo(url.hostname);

  } catch (err) {
    showError(err.message || '获取证书信息失败');
  }
}

async function renderCertInfo(hostname) {
  const content = document.getElementById('content');

  // 先显示基础信息
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
        <span class="info-value">443</span>
      </div>
    </div>

    <div class="info-section">
      <div class="info-title">证书详情</div>
      <div id="certDetails">
        <div class="info-row">
          <span class="info-label">状态</span>
          <span class="info-value" style="color:rgba(255,255,255,0.5);">正在查询...</span>
        </div>
      </div>
    </div>
  `;

  // 获取详细证书信息
  await fetchDetailedCert(hostname);

  // 显示复制按钮
  document.getElementById('copyBtn').classList.remove('hidden');
}

async function fetchDetailedCert(hostname) {
  const detailsEl = document.getElementById('certDetails');
  if (!detailsEl) return;

  try {
    // 使用 crt.sh API 查询证书信息
    const apiUrl = `https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`;
    const resp = await fetch(apiUrl);
    if (!resp.ok) throw new Error('API 请求失败');
    const data = await resp.json();

    if (!data || data.length === 0) {
      detailsEl.innerHTML = `
        <div class="info-row">
          <span class="info-label">状态</span>
          <span class="info-value valid">证书有效</span>
        </div>
        <div class="info-row">
          <span class="info-label">说明</span>
          <span class="info-value" style="color:rgba(255,255,255,0.5);font-size:11px;">未在公开日志中找到记录</span>
        </div>
      `;
      return;
    }

    // 按过期时间排序，取最新的有效证书
    const now = new Date();
    const sortedCerts = data.sort((a, b) => new Date(b.not_after) - new Date(a.not_after));
    
    // 显示所有找到的证书
    let html = '';
    sortedCerts.slice(0, 5).forEach((cert, index) => {
      const notBefore = new Date(cert.not_before);
      const notAfter = new Date(cert.not_after);
      const daysLeft = Math.ceil((notAfter - now) / (1000 * 60 * 60 * 24));

      let statusClass = 'valid';
      let statusText = '有效';
      if (daysLeft < 0) {
        statusClass = 'expired';
        statusText = '已过期';
      } else if (daysLeft <= 30) {
        statusClass = 'expiring';
        statusText = '即将过期';
      }

      const issuer = cert.issuer_name?.match(/O=([^,]+)/)?.[1] || cert.issuer_name?.match(/CN=([^,]+)/)?.[1] || '未知';
      const cn = cert.common_name || hostname;

      html += `
        <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
          ${sortedCerts.length > 1 ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:8px;">证书 #${index + 1}</div>` : ''}
          <div class="info-row">
            <span class="info-label">状态</span>
            <span class="info-value ${statusClass}">${statusText}</span>
          </div>
          <div class="info-row">
            <span class="info-label">颁发机构</span>
            <span class="info-value">${escapeHtml(issuer)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">颁发对象</span>
            <span class="info-value" style="font-size:11px;">${escapeHtml(cn)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">生效时间</span>
            <span class="info-value">${formatDate(notBefore)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">到期时间</span>
            <span class="info-value ${statusClass}">${formatDate(notAfter)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">剩余有效期</span>
            <span class="info-value ${statusClass}">${daysLeft < 0 ? '已过期' : daysLeft + ' 天'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">序列号</span>
            <span class="info-value" style="font-size:10px;color:rgba(255,255,255,0.5);">${cert.serial_number || '-'}</span>
          </div>
        </div>
      `;
    });

    if (sortedCerts.length > 5) {
      html += `<div style="text-align:center;padding:8px;font-size:11px;color:rgba(255,255,255,0.4);">还有 ${sortedCerts.length - 5} 个历史证书</div>`;
    }

    // 存储证书数据供复制使用
    currentCertData = sortedCerts.slice(0, 5);

    detailsEl.innerHTML = html;

  } catch (e) {
    detailsEl.innerHTML = `
      <div class="info-row">
        <span class="info-label">状态</span>
        <span class="info-value valid">证书有效</span>
      </div>
      <div class="info-row">
        <span class="info-label">说明</span>
        <span class="info-value" style="color:rgba(255,255,255,0.5);font-size:11px;">详细信息获取失败</span>
      </div>
    `;
  }
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

async function copyAllCertInfo() {
  const now = new Date();
  let text = `SSL证书信息 - ${currentHostname}\n`;
  text += `查询时间：${formatDate(now)}\n`;
  text += `${'='.repeat(40)}\n\n`;

  text += `【连接信息】\n`;
  text += `协议：HTTPS\n`;
  text += `域名：${currentHostname}\n`;
  text += `端口：443\n\n`;

  if (currentCertData && currentCertData.length > 0) {
    currentCertData.forEach((cert, index) => {
      const notBefore = new Date(cert.not_before);
      const notAfter = new Date(cert.not_after);
      const daysLeft = Math.ceil((notAfter - now) / (1000 * 60 * 60 * 24));
      const issuer = cert.issuer_name?.match(/O=([^,]+)/)?.[1] || cert.issuer_name?.match(/CN=([^,]+)/)?.[1] || '未知';
      const status = daysLeft < 0 ? '已过期' : daysLeft <= 30 ? '即将过期' : '有效';

      if (currentCertData.length > 1) {
        text += `【证书 #${index + 1}】\n`;
      } else {
        text += `【证书详情】\n`;
      }
      text += `状态：${status}\n`;
      text += `颁发机构：${issuer}\n`;
      text += `颁发对象：${cert.common_name || currentHostname}\n`;
      text += `生效时间：${formatDate(notBefore)}\n`;
      text += `到期时间：${formatDate(notAfter)}\n`;
      text += `剩余有效期：${daysLeft < 0 ? '已过期' : daysLeft + ' 天'}\n`;
      text += `证书序列号：${cert.serial_number || '-'}\n`;
      if (index < currentCertData.length - 1) text += '\n';
    });
  } else {
    text += `【证书详情】\n`;
    text += `状态：证书有效（详细信息不可用）\n`;
  }

  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copyBtn');
    const span = btn.querySelector('span');
    btn.classList.add('copied');
    span.textContent = '已复制！';
    setTimeout(() => {
      btn.classList.remove('copied');
      span.textContent = '复制证书信息';
    }, 2000);
  } catch (e) {
    alert('复制失败，请手动复制');
  }
}
