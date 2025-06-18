document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('start-date').value = today;
    document.getElementById('end-date').value = today;

    const settings = await window.electronAPI.getSettings();
    if (settings.icalUrl) {
        document.getElementById('ical-url').value = settings.icalUrl;
    }
    if (settings.geminiKey) {
        document.getElementById('gemini-api-key').value = settings.geminiKey;
    }

    await loadPreferences();
});

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

async function saveSettings() {
    const icalUrl = document.getElementById('ical-url').value.trim();
    const geminiKey = document.getElementById('gemini-api-key').value.trim();
    const statusEl = document.getElementById('settings-status');

    if (!icalUrl) {
        statusEl.innerHTML = '<div class="error">請輸入 iCal 私人網址</div>';
        return;
    }

    if (!icalUrl.includes('.ics') || !icalUrl.startsWith('https://')) {
        statusEl.innerHTML = '<div class="error">請輸入有效的 iCal 網址（應以 https:// 開頭並包含 .ics）</div>';
        return;
    }

    if (!geminiKey) {
        statusEl.innerHTML = '<div class="error">請輸入 Gemini API 金鑰</div>';
        return;
    }

    try {
        await window.electronAPI.saveSettings({ icalUrl, geminiKey });
        statusEl.innerHTML = '<div class="success">設定已成功儲存！</div>';
        setTimeout(() => {
            statusEl.innerHTML = '';
        }, 3000);
    } catch (error) {
        statusEl.innerHTML = `<div class="error">儲存失敗：${error.message}</div>`;
    }
}

async function loadPreferences() {
    const preferences = await window.electronAPI.getPreferences();
    displayPreferences(preferences);
}

function displayPreferences(preferences) {
    const listEl = document.getElementById('preference-list');
    listEl.innerHTML = '';

    if (preferences.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">尚未設定任何偏好</div>';
        return;
    }

    preferences.forEach((pref, index) => {
        const item = document.createElement('div');
        item.className = 'preference-item';
        item.innerHTML = `
            <span>${pref}</span>
            <button onclick="removePreference(${index})">刪除</button>
        `;
        listEl.appendChild(item);
    });
}

async function addPreference() {
    const input = document.getElementById('new-preference');
    const preference = input.value.trim();

    if (!preference) {
        alert('請輸入偏好設定');
        return;
    }

    const preferences = await window.electronAPI.getPreferences();
    preferences.push(preference);
    
    await window.electronAPI.savePreferences(preferences);
    input.value = '';
    await loadPreferences();
}

async function removePreference(index) {
    if (!confirm('確定要刪除這個偏好設定嗎？')) {
        return;
    }

    const preferences = await window.electronAPI.getPreferences();
    preferences.splice(index, 1);
    
    await window.electronAPI.savePreferences(preferences);
    await loadPreferences();
}

async function fetchAndPrioritizeTasks() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;

    if (!startDate || !endDate) {
        alert('請選擇開始和結束日期');
        return;
    }

    const statusEl = document.getElementById('task-status');
    const listEl = document.getElementById('task-list');

    const settings = await window.electronAPI.getSettings();
    if (!settings.icalUrl || !settings.geminiKey) {
        statusEl.innerHTML = '<div class="error">請先在設定頁面中設定 iCal 網址和 Gemini API 金鑰</div>';
        return;
    }

    statusEl.innerHTML = '<div class="loading">正在獲取日曆事件</div>';
    listEl.innerHTML = '';

    try {
        const events = await window.electronAPI.getCalendarEvents({ 
            startDate: new Date(startDate), 
            endDate: new Date(endDate + 'T23:59:59') 
        });

        if (events.length === 0) {
            statusEl.innerHTML = '<div class="error">在選定期間內沒有找到任何事件</div>';
            return;
        }

        statusEl.innerHTML = `<div class="loading">找到 ${events.length} 個事件，正在使用 AI 排序</div>`;

        const preferences = await window.electronAPI.getPreferences();

        const prioritizedTasks = await window.electronAPI.prioritizeTasks({ 
            tasks: events, 
            preferences 
        });

        displayTasks(prioritizedTasks);
        statusEl.innerHTML = `<div class="success">成功排序 ${prioritizedTasks.length} 個任務</div>`;

    } catch (error) {
        statusEl.innerHTML = `<div class="error">錯誤：${error.message}</div>`;
        console.error('Error:', error);
    }
}

function displayTasks(tasks) {
    const listEl = document.getElementById('task-list');
    listEl.innerHTML = '';

    if (!tasks || tasks.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #999; padding: 40px;">沒有任務可顯示</div>';
        return;
    }

    tasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'task-item';
        
        let taskHtml = `
            <div class="task-title">${index + 1}. ${task.title || '無標題'}</div>
        `;

        if (task.description) {
            taskHtml += `<div class="task-description">${task.description}</div>`;
        }

        if (task.startTime) {
            const startTime = new Date(task.startTime).toLocaleString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            taskHtml += `<div class="task-description">開始時間：${startTime}</div>`;
        }

        if (task.endTime) {
            const endTime = new Date(task.endTime).toLocaleString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            taskHtml += `<div class="task-description">結束時間：${endTime}</div>`;
        }

        if (task.reason) {
            taskHtml += `<div class="task-reason">優先理由：${task.reason}</div>`;
        }

        taskEl.innerHTML = taskHtml;
        listEl.appendChild(taskEl);
    });
}
