import { runInRenderer } from './cdp-client.mjs'

/**
 * 账号登录弹窗的共享辅助模块。
 * 供本地调试脚本复用，封装打开弹窗、选择平台、选择登录方式等常见操作。
 */

const getModal = `const view = document.getElementById('view'); const modal = view ? view.lastElementChild : document.body;`

/**
 * 等待弹窗出现
 * @param {WebSocket} ws
 * @param {number} [maxAttempts=10]
 * @param {number} [intervalMs=300]
 * @returns {Promise<boolean>}
 */
export async function waitForModal(ws, maxAttempts = 10, intervalMs = 300) {
  for (let i = 0; i < maxAttempts; i++) {
    const found = await runInRenderer(ws, `(() => { ${getModal} return !!(modal && modal.offsetWidth && (modal.innerText || modal.textContent || '').includes('平台账号管理')); })()`)
    if (found) return true
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

/**
 * 打开账号登录弹窗（先导航到设置页，再调用调试 helper 或 fallback 点击按钮）
 * @param {WebSocket} ws
 * @param {number} [waitMs=600]
 * @returns {Promise<boolean>}
 */
export async function openAccountModal(ws, waitMs = 600) {
  await runInRenderer(ws, `
    (() => {
      const link = document.querySelector('a[href="#/setting"]') || document.querySelector('a[aria-label="设置"]');
      if (link) { link.click(); return 'clicked setting nav'; }
      return 'no setting link';
    })()
  `)
  await new Promise(r => setTimeout(r, waitMs))

  const helperResult = await runInRenderer(ws, `
    (() => {
      if (typeof window.__openAccountModal === 'function') {
        window.__openAccountModal();
        return 'opened via helper';
      }
      return 'helper not ready';
    })()
  `)

  // 如果调试 helper 不可用，fallback 点击设置页中的"平台账号管理"按钮
  if (helperResult !== 'opened via helper') {
    await runInRenderer(ws, `
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(e =>
          (e.innerText || e.textContent || '').includes('平台账号管理')
        );
        if (btn) { btn.click(); return 'clicked platform account button'; }
        return 'platform account button not found';
      })()
    `)
  }
  await new Promise(r => setTimeout(r, waitMs))

  return waitForModal(ws)
}

/**
 * 选择平台（网易云音乐 / 酷狗音乐 / QQ音乐）
 * @param {WebSocket} ws
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function selectPlatform(ws, name) {
  await runInRenderer(ws, `
    (() => {
      ${getModal}
      const platformLabel = Array.from(modal.querySelectorAll('*')).find(e => (e.innerText || e.textContent || '').trim() === '平台');
      let select = platformLabel?.nextElementSibling || platformLabel?.parentElement?.querySelector('.base-Selection, [class*="Selection"]');
      if (!select) select = modal.querySelector('.base-Selection, [class*="Selection"]');
      const label = select?.querySelector('[class*="label"]') || select;
      if (label) { label.click(); return 'opened platform select'; }
      return 'platform select not found';
    })()
  `)
  await new Promise(r => setTimeout(r, 500))

  await runInRenderer(ws, `
    (() => {
      const li = Array.from(document.querySelectorAll('li')).find(e => (e.innerText || e.textContent).trim() === '${name}');
      if (li) { li.click(); return 'selected ${name}'; }
      return '${name} not found';
    })()
  `)
  await new Promise(r => setTimeout(r, 500))
}

/**
 * 选择登录方式（短信 / 二维码 / 密码 / Cookie）
 * @param {WebSocket} ws
 * @param {string} name
 */
export async function selectMethod(ws, name) {
  await runInRenderer(ws, `
    (() => {
      ${getModal}
      const btn = Array.from(modal.querySelectorAll('button')).find(e => (e.innerText || e.textContent || '').trim() === '${name}');
      if (btn) { btn.click(); return 'clicked ${name}'; }
      return '${name} not found';
    })()
  `)
  await new Promise(r => setTimeout(r, 500))
}

/**
 * 填写手机号
 * @param {WebSocket} ws
 * @param {string} phone
 */
export async function fillPhone(ws, phone) {
  await runInRenderer(ws, `
    (() => {
      ${getModal}
      const input = modal.querySelector('input[type="tel"]');
      if (input) {
        input.value = '${phone}';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
      }
      return { error: 'phone input not found' };
    })()
  `)
}

/**
 * 点击发送验证码按钮
 * @param {WebSocket} ws
 */
export async function clickSendCode(ws) {
  await runInRenderer(ws, `
    (() => {
      ${getModal}
      const sendBtn = Array.from(modal.querySelectorAll('button')).find(e => (e.innerText || e.textContent).includes('验证码'));
      if (sendBtn) { sendBtn.click(); return 'clicked send code'; }
      return 'send code button not found';
    })()
  `)
}

/**
 * 读取弹窗中的错误文本
 * @param {WebSocket} ws
 * @returns {Promise<string>}
 */
export async function readModalError(ws) {
  return runInRenderer(ws, `
    (() => {
      ${getModal}
      const errorEl = Array.from(modal.querySelectorAll('[class*="error"]')).find(e => e.innerText);
      return errorEl?.innerText?.trim() || '';
    })()
  `)
}

/**
 * 读取弹窗主体文本摘要
 * @param {WebSocket} ws
 * @param {number} [maxLen=350]
 * @returns {Promise<string>}
 */
export async function readModalBody(ws, maxLen = 350) {
  return runInRenderer(ws, `
    (() => {
      ${getModal}
      return (modal.innerText || modal.textContent || '').slice(0, ${maxLen});
    })()
  `)
}

/**
 * 读取二维码区域状态
 * @param {WebSocket} ws
 * @returns {Promise<object>}
 */
export async function readQrState(ws) {
  return runInRenderer(ws, `
    (() => {
      ${getModal}
      const qrSection = modal.querySelector('[class*="qrcodeSection"]') || modal;
      const qrCard = modal.querySelector('[class*="qrcodeCard"]');
      const img = qrCard ? qrCard.querySelector('img') : qrSection.querySelector('img');
      const placeholder = qrCard ? qrCard.querySelector('[class*="qrcodePlaceholder"]') : null;
      const status = Array.from(modal.querySelectorAll('p')).find(e =>
        (e.innerText || '').includes('二维码') || (e.innerText || '').includes('登录') || (e.innerText || '').includes('扫描')
      );
      return {
        hasImg: !!img,
        hasPlaceholder: !!placeholder,
        imgSrc: img ? img.src.slice(0, 80) + '...' : '',
        statusText: status?.innerText?.trim() || '',
        body: (qrSection.innerText || qrSection.textContent || '').slice(0, 200),
      };
    })()
  `)
}
