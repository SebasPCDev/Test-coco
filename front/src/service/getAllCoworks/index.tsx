const urlBase = process.env.NEXT_PUBLIC_API_URL;
import { ICowork } from "./types";

export const getAllCoworks = async (): Promise<ICowork[]> => {
  try {
    const response = await fetch(`http://localhost:3000/coworkings`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: ICowork[] = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching products:", error);
    return [];
  }
};

export default getAllCoworks;
