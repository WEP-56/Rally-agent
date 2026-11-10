// Simulate a native PTY spawn that has not returned yet, without a real shell.
process.on('message', () => process.send?.({ type: 'data', seq: 1, data: 'SPAWNING' }));
setInterval(() => {}, 60000);
