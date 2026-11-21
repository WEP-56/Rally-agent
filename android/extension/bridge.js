// Only this APK's extension page can access the native connection bridge.
const port = browser.runtime.connectNative('rally');
// Gecko's Java event bridge requires homogeneous arrays; RPC args may mix types.
// Keep the envelope a JSON string on this hop and decode it in our native delegate.
const send = value => port.postMessage({ json: JSON.stringify(value) });
window.RallyAndroid = {
  call(id, method, json) { send({ id, method, args: JSON.parse(json) }); }
};
port.onMessage.addListener(message => {
  if (message.type === 'back') {
    send({ type: 'back', handled: !window.dispatchEvent(new Event('rally-back', { cancelable: true })) });
  } else {
    const reply = JSON.parse(message.json);
    window.rallyReply?.(reply.id, reply.ok, reply.value);
  }
});
port.onDisconnect.addListener(() => window.rallyStartup?.fail('客户端连接已关闭，请重新打开 Rally。'));
