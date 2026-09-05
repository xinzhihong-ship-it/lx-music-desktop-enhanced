import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";

const getWsUrl = () =>
	new Promise((resolve, reject) => {
		http
			.get("http://127.0.0.1:5858/json/list", (res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					try {
						resolve(JSON.parse(data)[0].webSocketDebuggerUrl);
					} catch (err) {
						reject(err);
					}
				});
			})
			.on("error", reject);
	});

const send = (ws, method, params) =>
	new Promise((resolve, reject) => {
		const id = Math.floor(Math.random() * 1e9);
		const handler = (buffer) => {
			let message;
			try {
				message = JSON.parse(buffer.toString());
			} catch (err) {
				ws.off("message", handler);
				reject(err);
				return;
			}
			if (message.id !== id) return;
			ws.off("message", handler);
			if (message.error) reject(new Error(message.error.message));
			else resolve(message.result);
		};
		ws.on("message", handler);
		ws.send(JSON.stringify({ id, method, params }));
	});

const ws = new WebSocket(await getWsUrl());
await new Promise((resolve, reject) => {
	ws.once("open", resolve);
	ws.once("error", reject);
});

const rendererCode = `
(async () => {
  const ipc = require('electron').ipcRenderer
  const accounts = await ipc.invoke('winMain_account_list')
  const results = []
  for (const source of ['kg', 'tx']) {
    const account = accounts.find(item => item.source === source)
    if (!account) {
      results.push({ source, error: 'missing saved account' })
      continue
    }
    try {
      const playlists = await ipc.invoke('winMain_account_playlists', account.id)
      const playlist = playlists.find(item => Number(item.total) > 0) || playlists[0]
      if (!playlist) {
        results.push({ source, error: 'missing playlist' })
        continue
      }
      const tracks = await ipc.invoke('winMain_account_playlist_tracks', {
        accountId: account.id,
        playlistId: playlist.id,
        dirId: playlist.dirId,
      })
      const daily = source === 'tx'
        ? await ipc.invoke('winMain_account_daily_tracks', account.id)
        : []
      results.push({ source, playlistName: playlist.name, playlistTracks: tracks.length, dailyTracks: daily.length })
    } catch (error) {
      results.push({ source, error: error.message })
    }
  }
  location.hash = '#/platformMusic'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const waitForRows = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const rows = document.querySelectorAll('.list-item').length
      const text = document.body.innerText
      if (rows > 0) return { rows, error: '' }
      if (text.includes('try max num') || text.includes('获取歌曲信息失败')) {
        return { rows: 0, error: text.includes('try max num') ? 'try max num' : '获取歌曲信息失败' }
      }
      await wait(500)
    }
    return { rows: 0, error: 'timed out waiting for song rows' }
  }
  await wait(2500)
  const ui = []
  for (const source of ['kg', 'tx']) {
    const result = results.find(item => item.source === source)
    const group = Array.from(document.querySelectorAll('section')).find(section =>
      section.querySelector('strong')?.innerText.includes(source === 'kg' ? '酷狗' : 'QQ')
    )
    const button = Array.from(group?.querySelectorAll('button') || []).find(item => item.innerText.trim() === result?.playlistName)
    if (!button) {
      ui.push({ source, error: 'playlist button missing' })
      continue
    }
    button.click()
    await wait(100)
    ui.push({ source, ...(await waitForRows()) })
  }
  const txGroup = Array.from(document.querySelectorAll('section')).find(section => section.querySelector('strong')?.innerText.includes('QQ'))
  const dailyButton = Array.from(txGroup?.querySelectorAll('button') || []).find(item => item.innerText.includes('每日推荐'))
  if (dailyButton) {
    dailyButton.click()
    await wait(100)
    ui.push({ source: 'tx-daily', ...(await waitForRows()) })
  } else {
    ui.push({ source: 'tx-daily', error: 'daily button missing' })
  }
  return { results, ui }
})()
`;

const expression = `
(() => {
  const require = process.mainModule.require.bind(process.mainModule)
  const { BrowserWindow } = require('electron')
  const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('localhost:9080'))
  if (!win) throw new Error('main renderer window not found')
  return win.webContents.executeJavaScript(${JSON.stringify(rendererCode)}, true)
})()
`;

const response = await send(ws, "Runtime.evaluate", {
	expression,
	awaitPromise: true,
	returnByValue: true,
});
ws.close();
if (response.exceptionDetails)
	throw new Error(
		response.exceptionDetails.exception?.description ||
			response.exceptionDetails.text,
	);

const { results, ui } = response.result?.value;
for (const source of ["kg", "tx"]) {
	const result = results.find((item) => item.source === source);
	assert.ok(result, `${source}: result missing`);
	assert.equal(result.error, undefined, `${source}: ${result.error}`);
	assert.ok(
		result.playlistTracks > 0,
		`${source}: playlist contains no tracks`,
	);
	if (source === "tx")
		assert.ok(
			result.dailyTracks > 0,
			"tx: daily recommendations contain no tracks",
		);
}
assert.ok(
	!JSON.stringify(results).includes("try max num"),
	"legacy anonymous playlist error returned",
);
for (const result of ui) {
	assert.equal(result.error, "", `${result.source} UI: ${result.error}`);
	assert.ok(result.rows > 0, `${result.source} UI: no song rows rendered`);
}
console.log(JSON.stringify({ results, ui }, null, 2));
