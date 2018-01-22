package SudokuSolver;

import java.util.ArrayList;

public class GameData {
	public class cell
	{
		public int value;
		public int rowId;
		public int colId;
		public int sqrId;
		public int sqrR;
		public int sqrC;
		ArrayList<Integer> pencilMark;

		public cell()
		{
			value = 0;
			rowId = 0;
			colId = 0;
			sqrId = 0;
			sqrR  = 0;
			sqrC  = 0;
			pencilMark = new ArrayList<Integer>();
			for (int i = 1 ; i <= 9; i++)
			{
				pencilMark.add(i);
			}
		}
	}
	
	public boolean validGame = true;
	public int remainCell = 0;
	public cell[] gameCells = new cell[81];
	
	public int getRow(int a)
	{
		return a/9;
	}
	
	public int getCol(int a)
	{
		return a%9;
	}
		
	public int getSqrRow(int a)
	{		
		return getRow(a)/3;
	}

	public int getSqrCol(int a)
	{		
		return (getCol(a)/3)%3;
	}
	
	public int getSqr(int a)
	{		
		return 3*(getSqrRow(a))+ getSqrCol(a);
	}
	
	public void initGame(int[][] gameTable)
	{	
		for (int i = 0 ; i < 9; i ++)
		{
			for (int j = 0 ; j < 9; j ++)
			{
				gameCells[i*9+j] = new cell();
				gameCells[i*9+j].value = gameTable[i][j];
				gameCells[i*9+j].rowId = getRow(i*9+j);
				gameCells[i*9+j].colId = getCol(i*9+j);;
				gameCells[i*9+j].sqrId = getSqr(i*9+j);
				gameCells[i*9+j].sqrR = getSqrRow(i*9+j);
				gameCells[i*9+j].sqrC = getSqrCol(i*9+j);
				if (gameTable[i][j] == 0)
				{
					remainCell++;
				}
				if (gameTable[i][j] != 0)
				{
					gameCells[i*9+j].pencilMark.clear();
				}
			}
		}
	}
	
	public void printGame()
	{	
		for (int i = 0 ; i < 9; i ++)
		{
			if(i%3 == 0)
			{
				for (int k = 0 ; k < 12; k ++)
				{
			        System.out.print("-");
				}
		        System.out.println();
			}
			for (int j = 0 ; j < 9; j ++)
			{
				if(j%3 == 0)
				{
			        System.out.print("|");
				}
		        System.out.print(gameCells[i*9+j].value);
			}
	        System.out.print("|");
	        System.out.println();
		}
		for (int k = 0 ; k < 12; k ++)
		{
	        System.out.print("-");
		}
        System.out.println();
	}
	
	public void updatePencilMark(int a)
	{
		int r = gameCells[a].rowId;
		int c = gameCells[a].colId;
		int sr = gameCells[a].sqrR;
		int sc = gameCells[a].sqrC;

		//check with row
		for (int i = 0 ; i < 9; i++)
		{
			gameCells[a].pencilMark.remove(Integer.valueOf(gameCells[r*9+i].value));
		}
		//check with col
		for (int i = 0 ; i < 9; i++)
		{
			gameCells[a].pencilMark.remove(Integer.valueOf(gameCells[i*9+c].value));
		}
		//check in square
		for (int i = 0 ; i < 3; i++)
		{
			for (int j = 0 ; j < 3; j++)
			{
				int cellid = (sr*3+i)*9+3*sc+j;
				gameCells[a].pencilMark.remove(Integer.valueOf(gameCells[cellid].value));
			}
		}
	}
	
	public void updateAllPencilMark()
	{
		for(int i = 0 ; i < 81; i++)
		{
			if(gameCells[i].value != 0)
			{
				continue;
			}
			updatePencilMark(i);
			if (gameCells[i].pencilMark.size()==0)
			{
				validGame = false;
			}
		}
	}
	
	public void printPencilMark(int a)
	{
		System.out.println(gameCells[a].pencilMark);
	}
	
	public boolean isSolved()
	{
		return ((validGame == true) &&(remainCell==0));
	}
	
	public void pencilMethod()
	{
		boolean hasNewValue = true;
		updateAllPencilMark();
		while ((hasNewValue == true) && (isSolved() == false))
		{
			hasNewValue = false;
			for (int a = 0 ; a < 81; a++)
			{
				if (gameCells[a].value != 0)
				{
					continue;
				}
				if (checkPencilMark(a) == true)
				{
					hasNewValue = true;
				}
			}
			updateAllPencilMark();
		}
	}

	
	public boolean checkPencilMark(int a)
	{
		if (gameCells[a].value != 0)
		{
			return false;
		}
		if (gameCells[a].pencilMark.size()==0)
		{
			validGame = false;			
			return false;
		}
		if (gameCells[a].pencilMark.size()==1)
		{
			setCellValue(a,gameCells[a].pencilMark.get(0));
			return true;
		}
		for (int p = 0 ; p < gameCells[a].pencilMark.size();p++)
		{
			int val = gameCells[a].pencilMark.get(p);
			if (isUniqueInRow(a,val)==true)
			{
				setCellValue(a,val);
				return true;
			}
			if (isUniqueInCol(a,val)==true)
			{
				setCellValue(a,val);
				return true;			
			}
			if (isUniqueInSqr(a,val)==true)
			{
				setCellValue(a,val);
				return true;			
			}
		}
		return false;
	}

	public boolean isUniqueInRow(int a, int val) 
	{
		int r = gameCells[a].rowId;
		for (int i = 0; i < 9; i++) 
		{
			int checkCellId = r * 9 + i;
			if ((a == checkCellId) ||(gameCells[checkCellId].value != 0))
			{
				continue;
			}
			if (gameCells[checkCellId].pencilMark.contains(Integer.valueOf(val)) == true) 
			{
				return false;
			}
		}
		return true;
	}

	public boolean isUniqueInCol(int a, int val) 
	{
		int c = gameCells[a].colId;
		for (int i = 0; i < 9; i++) 
		{
			int checkCellId = i * 9 + c;
			if ((a == checkCellId)||(gameCells[checkCellId].value != 0))
			{
				continue;
			}
			if (gameCells[checkCellId].pencilMark.contains(Integer.valueOf(val)) == true) 
			{
				return false;
			}
		}
		return true;
	}
	
	public boolean isUniqueInSqr(int a, int val) 
	{
		int sr = gameCells[a].sqrR;
		int sc = gameCells[a].sqrC;
		
		for (int i = 0; i < 3; i++) 
		{
			for (int j = 0; j < 3; j++) 
			{
				int checkCellId = (sr*3+i)*9+3*sc+j;
				if ((a == checkCellId)||(gameCells[checkCellId].value != 0))
				{
					continue;
				}
				if (gameCells[checkCellId].pencilMark.contains(Integer.valueOf(val)) == true) 
				{
					return false;
				}
			}
		}
			
		return true;
	}
	
	public void setCellValue(int a,int val)
	{
//		System.out.println(getRow(a)+"<->"+getCol(a)+":"+val);
		gameCells[a].value = val;
		remainCell--;
		updateAllPencilMark();
	}
}
