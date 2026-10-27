export function localDay(now = new Date(), timezone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dayOffset(day, offset) {
  assertDay(day);
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
export function clockTime(now = new Date(), timezone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}
export function isOnDay(timestamp, day, timezone = "Asia/Shanghai") {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return false;
  return localDay(new Date(timestamp), timezone) === day;
}
export function yesterday(now = new Date(), timezone = "Asia/Shanghai") { return dayOffset(localDay(now, timezone), -1); }
export function assertTime(value) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("定时时间应为 HH:mm"); return value; }
export function assertDay(day) { if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(`${day}T00:00:00Z`))||new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)throw new Error("日期应为真实的 YYYY-MM-DD");return day; }
export function dayWindow(day,timezone="Asia/Shanghai") {
  assertDay(day);
  const midnight=value=>{
    const desired=Date.parse(`${value}T00:00:00Z`);let guess=desired;
    for(let i=0;i<4;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)).filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));const actual=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);const next=guess+desired-actual;if(next===guess)break;guess=next;}
    return new Date(guess).toISOString();
  };
  return{start:midnight(day),end:midnight(dayOffset(day,1))};
}
