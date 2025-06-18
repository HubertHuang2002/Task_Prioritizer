const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const store = new Store();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 400,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    resizable: false,
    maximizable: false,
    title: 'Task Prioritizer'
  });

  mainWindow.loadFile('index.html');
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function parseICalDateTime(dtString, tzid) {
  if (dtString.includes('T')) {
    const year = dtString.substr(0, 4);
    const month = dtString.substr(4, 2);
    const day = dtString.substr(6, 2);
    const hour = dtString.substr(9, 2);
    const minute = dtString.substr(11, 2);
    const second = dtString.substr(13, 2);
    
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${dtString.endsWith('Z') ? 'Z' : ''}`);
  } else {
    const year = dtString.substr(0, 4);
    const month = dtString.substr(4, 2);
    const day = dtString.substr(6, 2);
    
    return new Date(`${year}-${month}-${day}`);
  }
}

function parseICalEvent(eventText) {
  const lines = eventText.split(/\r?\n/);
  const event = {};
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    while (i + 1 < lines.length && lines[i + 1].startsWith(' ')) {
      line += lines[i + 1].substring(1);
      i++;
    }
    
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = line.substring(0, colonIndex);
    const value = line.substring(colonIndex + 1);
    
    const mainKey = key.split(';')[0];
    
    switch (mainKey) {
      case 'UID':
        event.id = value;
        break;
      case 'SUMMARY':
        event.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n');
        break;
      case 'DESCRIPTION':
        event.description = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n');
        break;
      case 'LOCATION':
        event.location = value.replace(/\\,/g, ',').replace(/\\;/g, ';');
        break;
      case 'DTSTART':
        const dtStartParams = key.split(';').slice(1);
        const tzidStart = dtStartParams.find(p => p.startsWith('TZID='));
        event.startTime = parseICalDateTime(value, tzidStart);
        event.isAllDay = !value.includes('T');
        break;
      case 'DTEND':
        const dtEndParams = key.split(';').slice(1);
        const tzidEnd = dtEndParams.find(p => p.startsWith('TZID='));
        event.endTime = parseICalDateTime(value, tzidEnd);
        break;
      case 'STATUS':
        event.status = value;
        break;
      case 'PRIORITY':
        event.priority = value;
        break;
    }
  }
  
  return event;
}

function fetchICalEvents(icalUrl) {
  return new Promise((resolve, reject) => {
    https.get(icalUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const events = [];
          const eventBlocks = data.split('BEGIN:VEVENT');
          
          for (let i = 1; i < eventBlocks.length; i++) {
            const eventEnd = eventBlocks[i].indexOf('END:VEVENT');
            if (eventEnd !== -1) {
              const eventText = eventBlocks[i].substring(0, eventEnd);
              const event = parseICalEvent(eventText);
              if (event.summary) {
                events.push(event);
              }
            }
          }
          
          resolve(events);
        } catch (error) {
          reject(new Error('解析 iCal 資料時發生錯誤'));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}


ipcMain.handle('save-settings', async (event, { icalUrl, geminiKey }) => {
  store.set('icalUrl', icalUrl);
  store.set('geminiApiKey', geminiKey);
  return { success: true };
});

ipcMain.handle('get-settings', async () => {
  return {
    icalUrl: store.get('icalUrl', ''),
    geminiKey: store.get('geminiApiKey', '')
  };
});

ipcMain.handle('save-preferences', async (event, preferences) => {
  store.set('preferences', preferences);
  return { success: true };
});

ipcMain.handle('get-preferences', async () => {
  return store.get('preferences', []);
});

ipcMain.handle('get-calendar-events', async (event, { startDate, endDate }) => {
  try {
    const icalUrl = store.get('icalUrl');
    if (!icalUrl) {
      throw new Error('iCal 網址未設定');
    }

    const allEvents = await fetchICalEvents(icalUrl);

    const filteredEvents = allEvents.filter(event => {
      if (!event.startTime) return false;
      
      const eventStart = new Date(event.startTime);
      const eventEnd = event.endTime ? new Date(event.endTime) : eventStart;
      
      return eventEnd >= startDate && eventStart <= endDate;
    });

    const formattedEvents = filteredEvents.map(event => ({
      id: event.id || Math.random().toString(36).substr(2, 9),
      title: event.summary || '無標題',
      description: event.description || '',
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location || '',
      isAllDay: event.isAllDay || false,
      status: event.status || '',
      priority: event.priority || '',
      isTask: (event.summary && (
        event.summary.includes('任務') || 
        event.summary.includes('task') || 
        event.summary.includes('TODO') ||
        event.summary.includes('待辦') ||
        event.summary.includes('作業') ||
        event.summary.includes('deadline') ||
        event.summary.includes('due')
      )) || (event.description && (
        event.description.includes('#task') ||
        event.description.includes('#todo') ||
        event.description.includes('待完成')
      )) || 
      (!event.endTime || event.isAllDay)
    }));

    formattedEvents.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
      return timeA - timeB;
    });

    return formattedEvents;

  } catch (error) {
    console.error('獲取日曆事件時出錯:', error);

    if (error.message.includes('ENOTFOUND')) {
      throw new Error('無法連接到指定的 iCal 網址。請檢查網址是否正確。');
    } else if (error.message.includes('401') || error.message.includes('403')) {
      throw new Error('無權限訪問此日曆。請確認 iCal 網址是否正確。');
    } else {
      throw error;
    }
  }
});

ipcMain.handle('prioritize-tasks', async (event, { tasks, preferences }) => {
  try {
    const apiKey = store.get('geminiApiKey');
    if (!apiKey) {
      throw new Error('Gemini API 金鑰未設定');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
您是一個任務優先級排序助手。請根據以下使用者偏好和事件列表，重新排序這些事件/任務，特別關注那些看起來像是待辦任務的項目。

使用者偏好：
${preferences.length > 0 ? preferences.map((p, i) => `${i + 1}. ${p}`).join('\n') : '無特定偏好'}

事件/任務列表：
${tasks.map((t, i) => {
  let taskInfo = `${i + 1}. ${t.title}`;
  if (t.description) taskInfo += ` - 描述：${t.description}`;
  if (t.startTime) {
    const startTime = new Date(t.startTime);
    if (t.isAllDay) {
      taskInfo += ` - 日期：${startTime.toLocaleDateString('zh-TW')}（全天）`;
    } else {
      taskInfo += ` - 開始時間：${startTime.toLocaleString('zh-TW')}`;
    }
  }
  if (t.endTime && !t.isAllDay) {
    taskInfo += ` - 結束時間：${new Date(t.endTime).toLocaleString('zh-TW')}`;
  }
  if (t.location) taskInfo += ` - 地點：${t.location}`;
  if (t.isTask) taskInfo += ` [可能是任務]`;
  return taskInfo;
}).join('\n')}

請根據以下原則排序：
1. 優先考慮看起來像任務的項目（包含「任務」、「作業」、「TODO」、「待辦」等關鍵字，或是全天事件）
2. 考慮使用者的偏好設定
3. 考慮時間緊迫性（截止日期或開始時間）
4. 考慮任務的重要性和影響
5. 會議和約會通常不是任務，除非有明確的準備工作

請按照優先級從高到低的順序重新排列這些項目，並為每個項目提供一個簡短的理由。
請以 JSON 格式回覆，格式如下：
{
  "prioritizedTasks": [
    {
      "originalIndex": 0,
      "reason": "理由說明"
    }
  ]
}

請確保回傳有效的 JSON 格式。`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON 解析錯誤:', cleanedText);
      throw new Error('AI 回應格式錯誤，請重試');
    }
    
    const prioritizedTasks = parsed.prioritizedTasks.map(item => ({
      ...tasks[item.originalIndex],
      reason: item.reason
    }));

    return prioritizedTasks;

  } catch (error) {
    console.error('使用 Gemini API 排序任務時出錯:', error);
    
    if (error.message.includes('API key')) {
      throw new Error('Gemini API 金鑰無效或過期');
    } else if (error.message.includes('quota')) {
      throw new Error('Gemini API 配額已用完');
    } else {
      throw error;
    }
  }
});

