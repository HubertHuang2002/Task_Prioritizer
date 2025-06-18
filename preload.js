const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  
  savePreferences: (preferences) => ipcRenderer.invoke('save-preferences', preferences),
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  
  getCalendarEvents: (dateRange) => ipcRenderer.invoke('get-calendar-events', dateRange),
  prioritizeTasks: (data) => ipcRenderer.invoke('prioritize-tasks', data)
});