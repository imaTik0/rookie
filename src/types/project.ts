export type ProjectId = string & { __userId: never };

export interface User {
    id: ProjectId;
    name: string;
}
