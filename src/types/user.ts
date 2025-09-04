export type UserId = string&{__userId: never};

export interface User {
    id: UserId;
    name: string;
}