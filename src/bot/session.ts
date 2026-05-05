import SessionModel, { ISession } from '../models/Session';

export async function getSession(phone: string): Promise<ISession> {
  let session = await SessionModel.findOne({ phone });
  if (!session) {
    session = await SessionModel.create({ phone, step: 'idle', data: {} });
  }
  return session;
}

export async function setSession(
  phone: string,
  step:  string,
  data:  Record<string, any> = {}
): Promise<void> {
  await SessionModel.findOneAndUpdate(
    { phone },
    { step, data, updatedAt: new Date() },
    { upsert: true, new: true }
  );
}

export async function updateSessionData(
  phone:  string,
  newData: Record<string, any>
): Promise<void> {
  const session = await getSession(phone);
  await SessionModel.findOneAndUpdate(
    { phone },
    { data: { ...session.data, ...newData }, updatedAt: new Date() },
    { upsert: true }
  );
}

export async function clearSession(phone: string): Promise<void> {
  await SessionModel.findOneAndUpdate(
    { phone },
    { step: 'idle', data: {}, updatedAt: new Date() },
    { upsert: true }
  );
}