/** Age in whole years at `now`, computed in UTC. DOB is stored as a date; birthdays are compared by calendar date. */
export function ageFromDateOfBirth(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export const MINIMUM_AGE = 18;

export function isAdult(dob: Date, now: Date = new Date()): boolean {
  return ageFromDateOfBirth(dob, now) >= MINIMUM_AGE;
}
