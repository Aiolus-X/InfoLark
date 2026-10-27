export function recipientFor(config,state) {
  const recipient=state.recipient;
  if(recipient?.appId===config.appId)return recipient.enabled?recipient.openId:"";
  return config.recipient||"";
}
